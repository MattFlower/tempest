import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HookEvent } from "../../shared/ipc-types";

const DEFAULT_SOCKET_PATH = join(homedir(), ".tempest", "hook.sock");

/**
 * Unix domain socket server that receives hook events from tempest-hook.
 * Each client connects, sends a single JSON-encoded HookEvent, and disconnects.
 */
export class HookEventListener {
  private readonly socketPath: string;
  private server?: ReturnType<typeof Bun.listen> | null;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? DEFAULT_SOCKET_PATH;
  }

  start(onEvent: (event: HookEvent) => void): void {
    // Clean up stale socket
    try {
      unlinkSync(this.socketPath);
    } catch {
      // No stale socket
    }

    // Ensure parent directory exists
    const dir = join(this.socketPath, "..");
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });

    // Buffer per-connection data until close
    const buffers = new WeakMap<object, Uint8Array[]>();

    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open(socket) {
          buffers.set(socket, []);
        },
        data(socket, data) {
          const chunks = buffers.get(socket);
          chunks?.push(new Uint8Array(data));
        },
        close(socket) {
          const chunks = buffers.get(socket);
          if (!chunks || chunks.length === 0) return;

          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          try {
            const text = new TextDecoder().decode(combined);
            const raw = JSON.parse(text);
            // The hook binary sends snake_case keys — normalize to camelCase
            const event: HookEvent = {
              eventType: raw.event_type ?? raw.eventType,
              pid: raw.pid,
              sessionId: raw.session_id ?? raw.sessionId,
              cwd: raw.cwd,
              transcriptPath: raw.transcript_path ?? raw.transcriptPath,
              toolName: raw.tool_name ?? raw.toolName,
            };
            onEvent(event);
          } catch {
            // Ignore malformed messages
          }
        },
        error(_socket, error) {
          console.log(`[HookEventListener] Socket error: ${error}`);
        },
      },
    });

    console.log(`[HookEventListener] Listening on ${this.socketPath}`);
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    try {
      unlinkSync(this.socketPath);
    } catch {
      // Already removed
    }
  }
}
