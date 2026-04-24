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

  it("injects configured Pi env vars from the keychain before exec", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      piPath: "/bin/echo",
      piEnvVarNames: ["OPENAI_API_KEY", "MISSING_VAR", "ANTHROPIC_API_KEY"],
    };

    const fakeKeychain = {
      setSecret: async () => {},
      deleteSecret: async () => {},
      getSecret: async (name: string) => {
        if (name === "OPENAI_API_KEY") return "sk-test-O'Brien";
        if (name === "ANTHROPIC_API_KEY") return "ant-key";
        return null;
      },
    };

    const manager = new SessionManager(config, fakeKeychain);
    const { command } = await manager.buildPiCommand({
      workspacePath: tmpRoot,
    });

    const cmd = command[2]!;
    expect(cmd).toContain(`OPENAI_API_KEY=${shellQuote("sk-test-O'Brien")}`);
    expect(cmd).toContain(`ANTHROPIC_API_KEY=${shellQuote("ant-key")}`);
    // Missing var should simply be absent, not crash the launch.
    expect(cmd).not.toContain("MISSING_VAR=");
    // Assignments come before exec so the child process inherits them.
    expect(cmd.indexOf("OPENAI_API_KEY=")).toBeLessThan(cmd.indexOf("exec "));
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

describe("SessionManager.buildCodexCommand", () => {
  it("shell-quotes codex binary path and args, no session id", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      codexPath: "/bin/echo",
      codexArgs: ["--model", "gpt-5", "--name=O'Brien"],
    };

    const manager = new SessionManager(config);
    const { command } = await manager.buildCodexCommand({
      workspacePath: tmpRoot,
    });

    expect(command[0]).toBe("/bin/zsh");
    expect(command[1]).toBe("-lic");

    const cmd = command[2]!;
    expect(cmd).toContain(`exec ${shellQuote("/bin/echo")}`);
    expect(cmd).toContain(shellQuote("--model"));
    expect(cmd).toContain(shellQuote("gpt-5"));
    expect(cmd).toContain(shellQuote("--name=O'Brien"));
    expect(cmd).not.toContain(shellQuote("resume"));
  });

  it("adds `resume <sessionId>` before user args when sessionId is provided", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      codexPath: "/bin/echo",
      codexArgs: ["--flag"],
    };

    const manager = new SessionManager(config);
    const { command } = await manager.buildCodexCommand({
      workspacePath: tmpRoot,
      sessionId: "abc-123-xyz",
    });

    const cmd = command[2]!;
    const resumeIdx = cmd.indexOf(shellQuote("resume"));
    const idIdx = cmd.indexOf(shellQuote("abc-123-xyz"));
    const flagIdx = cmd.indexOf(shellQuote("--flag"));
    expect(resumeIdx).toBeGreaterThan(0);
    expect(idIdx).toBeGreaterThan(resumeIdx);
    expect(flagIdx).toBeGreaterThan(idIdx);
  });

  it("injects configured Codex env vars from the keychain before exec", async () => {
    mkdirSync(tmpRoot, { recursive: true });

    const config: AppConfig = {
      workspaceRoot: tmpRoot,
      claudeArgs: [],
      codexPath: "/bin/echo",
      codexEnvVarNames: ["OPENAI_API_KEY", "MISSING_VAR"],
    };

    const fakeKeychain = {
      setSecret: async () => {},
      deleteSecret: async () => {},
      getSecret: async (name: string) => {
        if (name === "OPENAI_API_KEY") return "sk-test";
        return null;
      },
    };

    const manager = new SessionManager(config, fakeKeychain);
    const { command } = await manager.buildCodexCommand({
      workspacePath: tmpRoot,
    });

    const cmd = command[2]!;
    expect(cmd).toContain(`OPENAI_API_KEY=${shellQuote("sk-test")}`);
    expect(cmd).not.toContain("MISSING_VAR=");
    expect(cmd.indexOf("OPENAI_API_KEY=")).toBeLessThan(cmd.indexOf("exec "));
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
