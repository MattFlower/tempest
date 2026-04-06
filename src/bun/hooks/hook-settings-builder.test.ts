import { describe, it, expect, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import { HookSettingsBuilder } from "./hook-settings-builder";

describe("HookSettingsBuilder", () => {
  // Track files created during tests so we can clean up
  const filesToCleanup: string[] = [];

  afterAll(async () => {
    for (const f of filesToCleanup) {
      try {
        await unlink(f);
      } catch {
        // ignore
      }
    }
  });

  describe("buildSettingsJSON", () => {
    const hookBinaryPath = "bun /path/to/tempest-hook.ts";
    const socketPath = "/tmp/tempest-501.sock";

    it("returns valid JSON string", () => {
      const json = HookSettingsBuilder.buildSettingsJSON(hookBinaryPath, socketPath);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("contains all expected hook event types", () => {
      const json = HookSettingsBuilder.buildSettingsJSON(hookBinaryPath, socketPath);
      const parsed = JSON.parse(json);
      const hooks = parsed.hooks;

      expect(hooks).toHaveProperty("SessionStart");
      expect(hooks).toHaveProperty("SessionEnd");
      expect(hooks).toHaveProperty("UserPromptSubmit");
      expect(hooks).toHaveProperty("PreToolUse");
      expect(hooks).toHaveProperty("Stop");
      expect(hooks).toHaveProperty("Notification");
      expect(hooks).toHaveProperty("PermissionRequest");
    });

    it("each hook entry contains the correct command format", () => {
      const json = HookSettingsBuilder.buildSettingsJSON(hookBinaryPath, socketPath);
      const parsed = JSON.parse(json);
      const hooks = parsed.hooks;

      // Check SessionStart as a representative single-entry hook
      const sessionStart = hooks.SessionStart[0];
      expect(sessionStart.hooks[0].type).toBe("command");
      expect(sessionStart.hooks[0].command).toBe(
        `${hookBinaryPath} session_start ${socketPath}`,
      );

      // Check PreToolUse
      const preToolUse = hooks.PreToolUse[0];
      expect(preToolUse.hooks[0].command).toBe(
        `${hookBinaryPath} pre_tool_use ${socketPath}`,
      );

      // Check PermissionRequest
      const permReq = hooks.PermissionRequest[0];
      expect(permReq.hooks[0].command).toBe(
        `${hookBinaryPath} permission_request ${socketPath}`,
      );
    });

    it("Notification hooks have correct matchers", () => {
      const json = HookSettingsBuilder.buildSettingsJSON(hookBinaryPath, socketPath);
      const parsed = JSON.parse(json);
      const notifications = parsed.hooks.Notification;

      expect(notifications).toHaveLength(2);
      expect(notifications[0].matcher).toBe("idle_prompt");
      expect(notifications[0].hooks[0].command).toBe(
        `${hookBinaryPath} idle_prompt ${socketPath}`,
      );
      expect(notifications[1].matcher).toBe("permission_prompt");
      expect(notifications[1].hooks[0].command).toBe(
        `${hookBinaryPath} permission_prompt ${socketPath}`,
      );
    });

    it("includes mcpServers config when channelScriptPath is provided", () => {
      const channelPath = "/path/to/tempest-channel.ts";
      const json = HookSettingsBuilder.buildSettingsJSON(
        hookBinaryPath,
        socketPath,
        channelPath,
      );
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty("mcpServers");
      const mcpServers = parsed.mcpServers;
      expect(mcpServers).toHaveProperty("tempest-pr");
      expect(mcpServers["tempest-pr"].command).toBe("bun");
      expect(mcpServers["tempest-pr"].args).toEqual([channelPath]);
      expect(mcpServers["tempest-pr"].env).toEqual({
        TEMPEST_SOCKET_PATH: socketPath,
      });
    });

    it("does not include mcpServers when channelScriptPath is NOT provided", () => {
      const json = HookSettingsBuilder.buildSettingsJSON(hookBinaryPath, socketPath);
      const parsed = JSON.parse(json);
      expect(parsed).not.toHaveProperty("mcpServers");
    });

    it("mcpServers config has correct structure", () => {
      const channelPath = "/some/script/tempest-channel.ts";
      const json = HookSettingsBuilder.buildSettingsJSON(
        hookBinaryPath,
        socketPath,
        channelPath,
      );
      const parsed = JSON.parse(json);
      const server = parsed.mcpServers["tempest-pr"];

      expect(server).toEqual({
        command: "bun",
        args: [channelPath],
        env: { TEMPEST_SOCKET_PATH: socketPath },
      });
    });
  });

  describe("writeSettingsFile", () => {
    const hookBinaryPath = "bun /path/to/tempest-hook.ts";
    const socketPath = "/tmp/tempest-501.sock";

    it("creates a file in ~/.config/tempest/ directory with valid JSON", async () => {
      const filePath = await HookSettingsBuilder.writeSettingsFile(
        hookBinaryPath,
        socketPath,
      );
      filesToCleanup.push(filePath);

      // Verify the path uses a content hash (12 hex chars)
      expect(filePath).toContain("/.config/tempest/");
      expect(filePath).toMatch(/settings-[0-9a-f]{12}\.json$/);

      // Verify the file contains valid JSON matching buildSettingsJSON output
      const file = Bun.file(filePath);
      const content = await file.text();
      const expectedJSON = HookSettingsBuilder.buildSettingsJSON(
        hookBinaryPath,
        socketPath,
      );
      expect(content).toBe(expectedJSON);
    });

    it("returns the same path for identical parameters (idempotent)", async () => {
      const path1 = await HookSettingsBuilder.writeSettingsFile(
        hookBinaryPath,
        socketPath,
      );
      const path2 = await HookSettingsBuilder.writeSettingsFile(
        hookBinaryPath,
        socketPath,
      );
      filesToCleanup.push(path1);

      expect(path1).toBe(path2);
    });

    it("returns different paths for different workspaceNames", async () => {
      const channelPath = "/path/to/tempest-channel.ts";
      const path1 = await HookSettingsBuilder.writeSettingsFile(
        hookBinaryPath,
        socketPath,
        channelPath,
        "workspace-a",
      );
      const path2 = await HookSettingsBuilder.writeSettingsFile(
        hookBinaryPath,
        socketPath,
        channelPath,
        "workspace-b",
      );
      filesToCleanup.push(path1, path2);

      expect(path1).not.toBe(path2);
    });
  });

  describe("static getters", () => {
    it("hookBinaryPath starts with 'bun ' and ends with 'tempest-hook.ts'", () => {
      const path = HookSettingsBuilder.hookBinaryPath;
      expect(path.startsWith("bun ")).toBe(true);
      expect(path.endsWith("tempest-hook.ts")).toBe(true);
    });

    it("channelScriptPath ends with 'tempest-channel.ts'", () => {
      expect(HookSettingsBuilder.channelScriptPath.endsWith("tempest-channel.ts")).toBe(
        true,
      );
    });

    it("socketPath starts with '/tmp/tempest-'", () => {
      expect(HookSettingsBuilder.socketPath.startsWith("/tmp/tempest-")).toBe(true);
    });
  });
});
