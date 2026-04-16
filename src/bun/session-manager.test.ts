import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../shared/ipc-types";
import { HookSettingsBuilder } from "./hooks/hook-settings-builder";
import { SessionManager } from "./session-manager";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const tmpRoot = join("/tmp", `tempest-session-manager-test-${Date.now()}`);

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("SessionManager.buildPiCommand", () => {
  it("quotes env, extension path, session path, and pi args safely", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const sessionPath = join(tmpRoot, "pi session O'Brien.jsonl");
    writeFileSync(sessionPath, "[]\n");

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      piPath: "/bin/echo",
      piArgs: ["--flag", "value with spaces", "--name=O'Brien"],
    };

    const manager = new SessionManager(config);
    const { command } = await manager.buildPiCommand({
      workspacePath: tmpRoot,
      sessionPath,
    });

    expect(command[0]).toBe("/bin/zsh");
    expect(command[1]).toBe("-lic");

    const cmd = command[2]!;
    expect(cmd).toContain(
      `TEMPEST_HOOK_SOCKET=${shellQuote(HookSettingsBuilder.socketPath)}`,
    );
    expect(cmd).toContain(`exec ${shellQuote("/bin/echo")}`);
    expect(cmd).toContain(shellQuote("-e"));
    expect(cmd).toContain(shellQuote(HookSettingsBuilder.piExtensionPath));
    expect(cmd).toContain(shellQuote("--session"));
    expect(cmd).toContain(shellQuote(sessionPath));
    expect(cmd).toContain(shellQuote("--flag"));
    expect(cmd).toContain(shellQuote("value with spaces"));
    expect(cmd).toContain(shellQuote("--name=O'Brien"));
  });

  it("omits --session when the saved Pi session file does not exist", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      piPath: "/bin/echo",
    };

    const manager = new SessionManager(config);
    const { command } = await manager.buildPiCommand({
      workspacePath: tmpRoot,
      sessionPath: join(tmpRoot, "missing-session.jsonl"),
    });

    const cmd = command[2]!;
    expect(cmd).not.toContain(shellQuote("--session"));
  });
});

describe("SessionManager.buildClaudeCommand", () => {
  it("shell-quotes Claude binary path and args", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: ["--flag", "value with spaces", "--name=O'Brien"],
      claudePath: "/bin/echo",
    };

    const manager = new SessionManager(config);
    const { command } = await manager.buildClaudeCommand({
      workspacePath: tmpRoot,
      resume: false,
      withHooks: false,
      planMode: true,
    });

    expect(command[0]).toBe("/bin/zsh");
    expect(command[1]).toBe("-lic");

    const cmd = command[2]!;
    expect(cmd).toContain(`exec ${shellQuote("/bin/echo")}`);
    expect(cmd).toContain(shellQuote("--permission-mode"));
    expect(cmd).toContain(shellQuote("plan"));
    expect(cmd).toContain(shellQuote("--flag"));
    expect(cmd).toContain(shellQuote("value with spaces"));
    expect(cmd).toContain(shellQuote("--name=O'Brien"));
  });

  it("does not throw when ~/.claude/projects is missing during resume checks", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const isolatedHome = join(tmpRoot, "home-no-projects");
    mkdirSync(isolatedHome, { recursive: true });

    const previousHome = process.env.HOME;
    process.env.HOME = isolatedHome;

    try {
      const config: AppConfig = {
        workspaceRoot: tmpRoot,
        claudeArgs: [],
        claudePath: "/bin/echo",
      };

      const manager = new SessionManager(config);
      const { command } = await manager.buildClaudeCommand({
        workspacePath: tmpRoot,
        resume: true,
        sessionId: "missing-session",
        withHooks: false,
      });

      expect(command[2]!).not.toContain("--resume");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});
