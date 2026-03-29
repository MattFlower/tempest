import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export class HookSettingsBuilder {
  static buildSettingsJSON(
    hookBinaryPath: string,
    socketPath: string,
    channelScriptPath?: string,
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
  ): Promise<string> {
    const json = this.buildSettingsJSON(
      hookBinaryPath,
      socketPath,
      channelScriptPath,
    );
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
