import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export class HookSettingsBuilder {
  static buildSettingsJSON(
    hookBinaryPath: string,
    socketPath: string,
  ): string {
    const cmd = (eventType: string) =>
      `${hookBinaryPath} ${eventType} ${socketPath}`;

    const entry = (eventType: string, matcher = "") => ({
      matcher,
      hooks: [{ type: "command", command: cmd(eventType) }],
    });

    const settings = {
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

    return JSON.stringify(settings, null, 2);
  }

  static async writeSettingsFile(
    hookBinaryPath: string,
    socketPath: string,
  ): Promise<string> {
    const json = this.buildSettingsJSON(hookBinaryPath, socketPath);
    const dir = join(homedir(), ".tempest");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `settings-${crypto.randomUUID()}.json`);
    await Bun.write(path, json);
    return path;
  }

  static async cleanupSettingsFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // Ignore — file may already be deleted
    }
  }

  // TODO: Update when tempest-hook binary build is configured.
  // For now, resolve relative to the bun entry point.
  static get hookBinaryPath(): string {
    return join(import.meta.dir, "../../bin/tempest-hook");
  }

  static get socketPath(): string {
    return `/tmp/tempest-${process.getuid?.() ?? 501}.sock`;
  }
}
