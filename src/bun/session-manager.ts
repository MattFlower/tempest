import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig } from "../shared/ipc-types";
import { HookSettingsBuilder } from "./hooks/hook-settings-builder";

export class SessionManager {
  private config: AppConfig;
  private cachedPATH: string;

  constructor(config: AppConfig) {
    this.config = config;
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
  }): Promise<{ command: string[]; settingsPath?: string }> {
    const claudePath = this.resolveBinary(
      "claude",
      this.config.claudePath,
    );

    const parts = [claudePath];

    if (params.resume && params.sessionId) {
      parts.push("--resume", params.sessionId);
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
      );
      parts.push("--settings", settingsPath);
    }

    parts.push(...this.config.claudeArgs);

    // Wrap in login shell so .zshrc/.zprofile are sourced.
    // exec replaces the shell process with claude (no extra process).
    const command = ["/bin/zsh", "-lic", `exec ${parts.join(" ")}`];

    return { command, settingsPath };
  }

  buildShellCommand(_params: {
    workspacePath: string;
  }): { command: string[] } {
    return { command: ["/bin/zsh", "-l"] };
  }

  async cleanupSettingsFile(path?: string): Promise<void> {
    if (path) {
      await HookSettingsBuilder.cleanupSettingsFile(path);
    }
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
