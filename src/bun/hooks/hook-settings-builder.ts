import { mkdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export class HookSettingsBuilder {
  static buildSettingsJSON(
    hookBinaryPath: string,
    socketPath: string,
    channelScriptPath?: string,
    workspaceName?: string,
  ): string {
    const cmd = (eventType: string) =>
      `${hookBinaryPath} ${eventType} ${socketPath}`;

    const entry = (eventType: string, matcher = "") => ({
      matcher,
      hooks: [{ type: "command", command: cmd(eventType) }],
    });

    const settings: Record<string, unknown> = {
      hooks: {
        SessionStart: [entry("session_start")],
        SessionEnd: [entry("session_end")],
        UserPromptSubmit: [entry("user_prompt")],
        PreToolUse: [entry("pre_tool_use")],
        Stop: [entry("stop")],
        Notification: [
          entry("idle_prompt", "idle_prompt"),
          entry("permission_prompt", "permission_prompt"),
        ],
        PermissionRequest: [entry("permission_request")],
      },
    };

    // Add channel MCP server config when requested
    if (channelScriptPath) {
      settings.mcpServers = {
        "tempest-pr": {
          command: "bun",
          args: [channelScriptPath],
          env: {
            TEMPEST_SOCKET_PATH: socketPath,
            ...(workspaceName ? { TEMPEST_WORKSPACE: workspaceName } : {}),
          },
        },
      };
    }

    return JSON.stringify(settings, null, 2);
  }

  static async writeSettingsFile(
    hookBinaryPath: string,
    socketPath: string,
    channelScriptPath?: string,
    workspaceName?: string,
  ): Promise<string> {
    const json = this.buildSettingsJSON(
      hookBinaryPath,
      socketPath,
      channelScriptPath,
      workspaceName,
    );
    const dir = join(homedir(), ".tempest");
    await mkdir(dir, { recursive: true });

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(json);
    const hash = hasher.digest("hex").slice(0, 12);
    const path = join(dir, `settings-${hash}.json`);

    const file = Bun.file(path);
    if (!(await file.exists())) {
      await Bun.write(path, json);
    }

    return path;
  }

  /** Write an MCP config file for use with `claude --mcp-config`. */
  static async writeMcpConfigFile(
    mcpPort: number,
    mcpToken: string,
    workspaceName: string,
  ): Promise<string> {
    const config = {
      mcpServers: {
        "tempest-webpage": {
          type: "http",
          url: `http://127.0.0.1:${mcpPort}/mcp/${encodeURIComponent(workspaceName)}`,
          headers: {
            Authorization: `Bearer ${mcpToken}`,
          },
        },
      },
    };

    const json = JSON.stringify(config, null, 2);
    const dir = join(homedir(), ".tempest");
    await mkdir(dir, { recursive: true });

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(json);
    const hash = hasher.digest("hex").slice(0, 12);
    const path = join(dir, `mcp-${hash}.json`);

    const file = Bun.file(path);
    if (!(await file.exists())) {
      await Bun.write(path, json);
    }

    return path;
  }

  /** Remove legacy UUID-named settings files and stale hash-based files. */
  static async cleanupStaleSettingsFiles(): Promise<void> {
    const dir = join(homedir(), ".tempest");
    const glob = new Bun.Glob("settings-*.json");
    const uuidPattern = /^settings-[0-9a-f]{8}-[0-9a-f]{4}-/;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for await (const name of glob.scan({ cwd: dir, onlyFiles: true })) {
      const fullPath = join(dir, name);

      // Always remove old UUID-based files (legacy cleanup)
      if (uuidPattern.test(name)) {
        try { await unlink(fullPath); } catch {}
        continue;
      }

      // For hash-based files, remove if older than 7 days
      try {
        const s = await stat(fullPath);
        if (Date.now() - s.mtimeMs > sevenDaysMs) {
          await unlink(fullPath);
        }
      } catch {}
    }
  }

  // Resolve the tempest-hook script path relative to this file.
  // In production, this will be bundled in the app's Resources directory.
  static get hookBinaryPath(): string {
    return `bun ${join(import.meta.dir, "tempest-hook.ts")}`;
  }

  static get channelScriptPath(): string {
    return join(import.meta.dir, "tempest-channel.ts");
  }

  static get socketPath(): string {
    return `/tmp/tempest-${process.getuid?.() ?? 501}.sock`;
  }

}
