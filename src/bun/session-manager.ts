import { createHash } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig } from "../shared/ipc-types";
import { HookSettingsBuilder } from "./hooks/hook-settings-builder";
import type { KeychainClient } from "./keychain";

/** POSIX single-quote escape so a string is safe to splice into a shell command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export class SessionManager {
  private config: AppConfig;
  private cachedPATH: string;
  private keychain: KeychainClient | null;

  constructor(config: AppConfig, keychain: KeychainClient | null = null) {
    this.config = config;
    this.keychain = keychain;
    this.cachedPATH = this.captureLoginShellPATH();
  }

  updateConfig(config: AppConfig) {
    this.config = config;
  }

  async buildClaudeCommand(params: {
    workspacePath: string;
    resume: boolean;
    sessionId?: string;
    withHooks: boolean;
    withChannel?: boolean;
    withMcp?: boolean;
    mcpPort?: number;
    mcpToken?: string;
    workspaceName?: string;
    planMode?: boolean;
  }): Promise<{ command: string[]; settingsPath?: string }> {
    const claudePath = this.resolveBinary(
      "claude",
      this.config.claudePath,
    );

    const parts = [claudePath];

    if (params.resume && params.sessionId) {
      // Check if the session file still exists before attempting --resume
      if (await this.sessionExists(params.sessionId, params.workspacePath)) {
        parts.push("--resume", params.sessionId);
      } else {
        console.log(`[session] Session ${params.sessionId} not found, starting new session`);
        // Don't pass --resume — start fresh
      }
    } else if (params.resume) {
      parts.push("-c");
    }

    let settingsPath: string | undefined;

    if (params.withHooks) {
      const channelPath = params.withChannel
        ? HookSettingsBuilder.channelScriptPath
        : undefined;
      settingsPath = await HookSettingsBuilder.writeSettingsFile(
        HookSettingsBuilder.hookBinaryPath,
        HookSettingsBuilder.socketPath,
        channelPath,
        params.workspaceName,
        params.workspacePath,
      );
      parts.push("--settings", settingsPath);
    }

    if (params.withMcp && params.mcpPort && params.mcpToken) {
      const workspaceKey = createHash("sha256")
        .update(params.workspacePath)
        .digest("hex")
        .slice(0, 16);
      const mcpConfigPath = await HookSettingsBuilder.writeMcpConfigFile(
        params.mcpPort,
        params.mcpToken,
        workspaceKey,
      );
      parts.push("--mcp-config", mcpConfigPath);
    }

    if (params.planMode) {
      parts.push("--permission-mode", "plan");
    }

    parts.push(...this.config.claudeArgs);

    // Wrap in login shell so .zshrc/.zprofile are sourced.
    // exec replaces the shell process with claude (no extra process).
    // Shell-quote all parts so user/config paths and args are not reinterpreted by zsh.
    const quoted = parts.map(shellQuote).join(" ");
    const command = ["/bin/zsh", "-lic", `exec ${quoted}`];

    return { command, settingsPath };
  }

  buildShellCommand(_params: {
    workspacePath: string;
  }): { command: string[] } {
    return { command: ["/bin/zsh", "-l"] };
  }

  async buildPiCommand(params: {
    workspacePath: string;
    sessionPath?: string;
  }): Promise<{ command: string[] }> {
    const piPath = this.resolveBinary("pi", this.config.piPath);
    const parts = [piPath, "-e", HookSettingsBuilder.piExtensionPath];

    if (params.sessionPath) {
      if (await Bun.file(params.sessionPath).exists()) {
        parts.push("--session", params.sessionPath);
      } else {
        console.log(
          `[session] Pi session ${params.sessionPath} not found, starting new session`,
        );
      }
    }

    parts.push(...(this.config.piArgs ?? []));

    // Shell-quote everything: parts may include arbitrary user paths
    // (workspaces with spaces, session files, configured piArgs) that
    // would otherwise be reinterpreted by zsh -lic.
    const quoted = parts.map(shellQuote).join(" ");
    const envAssignments = [
      `TEMPEST_HOOK_SOCKET=${shellQuote(HookSettingsBuilder.socketPath)}`,
      ...(await this.buildAgentEnvAssignments("pi", this.config.piEnvVarNames ?? [])),
    ].join(" ");
    const command = ["/bin/zsh", "-lic", `${envAssignments} exec ${quoted}`];
    return { command };
  }

  async buildCodexCommand(params: {
    workspacePath: string;
    sessionId?: string;
  }): Promise<{ command: string[] }> {
    const codexPath = this.resolveBinary("codex", this.config.codexPath);
    const parts: string[] = [codexPath];

    if (params.sessionId) {
      parts.push("resume", params.sessionId);
    }

    parts.push(...(this.config.codexArgs ?? []));

    const quoted = parts.map(shellQuote).join(" ");
    const assignments = await this.buildAgentEnvAssignments(
      "codex",
      this.config.codexEnvVarNames ?? [],
    );
    const prefix = assignments.length > 0 ? `${assignments.join(" ")} ` : "";
    const command = ["/bin/zsh", "-lic", `${prefix}exec ${quoted}`];
    return { command };
  }

  /**
   * Resolve each configured env var name to a keychain value and return
   * shell-quoted `NAME='value'` fragments. Names that fail to resolve (missing
   * from keychain, or keychain unavailable) are skipped with a warning so a
   * partial config can't block the agent from launching entirely.
   */
  private async buildAgentEnvAssignments(
    agent: string,
    names: string[],
  ): Promise<string[]> {
    if (names.length === 0 || !this.keychain) return [];

    const assignments: string[] = [];
    for (const name of names) {
      try {
        const value = await this.keychain.getSecret(name);
        if (value === null) {
          console.warn(
            `[session] ${agent} env var ${name} not found in keychain, skipping`,
          );
          continue;
        }
        assignments.push(`${name}=${shellQuote(value)}`);
      } catch (err) {
        console.warn(`[session] Failed to read keychain for ${name}:`, err);
      }
    }
    return assignments;
  }

  /** Check if a Claude session JSONL file exists under ~/.claude/projects/ */
  private async sessionExists(sessionId: string, workspacePath: string): Promise<boolean> {
    const home = homedir();
    // Claude encodes workspace paths as directory names with / replaced by -
    const encodedPath = workspacePath.replace(/\//g, "-");
    const directPath = join(home, ".claude", "projects", encodedPath, `${sessionId}.jsonl`);

    if (await Bun.file(directPath).exists()) return true;

    // Fallback: glob across all project directories
    const glob = new Bun.Glob(`*/${sessionId}.jsonl`);
    const projectsDir = join(home, ".claude", "projects");
    if (!existsSync(projectsDir)) return false;

    try {
      for await (const _ of glob.scan({ cwd: projectsDir, onlyFiles: true })) {
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  private resolveBinary(name: string, configuredPath?: string): string {
    if (configuredPath) {
      try {
        accessSync(configuredPath, constants.X_OK);
        return configuredPath;
      } catch {
        throw new Error(
          `Configured path '${configuredPath}' for '${name}' is not executable`,
        );
      }
    }

    const dirs = this.cachedPATH.split(":");
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not found in this directory, continue
      }
    }

    throw new Error(`'${name}' not found in PATH`);
  }

  private captureLoginShellPATH(): string {
    const fallback = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

    try {
      const result = Bun.spawnSync({
        cmd: ["/bin/zsh", "-l", "-c", "echo $PATH"],
        stdout: "pipe",
        stderr: "ignore",
      });

      const output = result.stdout.toString().trim();
      if (!output) return this.appendAdditionalPaths(fallback);
      return this.appendAdditionalPaths(output);
    } catch {
      return this.appendAdditionalPaths(fallback);
    }
  }

  private appendAdditionalPaths(shellPATH: string): string {
    const home = homedir();
    const additional = [
      join(home, ".local/bin"),
      join(home, ".cargo/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ];

    const existing = new Set(shellPATH.split(":"));
    const missing = additional.filter((p) => !existing.has(p));

    if (missing.length > 0) {
      return shellPATH + ":" + missing.join(":");
    }
    return shellPATH;
  }
}
