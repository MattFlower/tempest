// Pi coding-agent extension shipped with Tempest. Loaded by Pi via
// `pi -e <path>` and reports the session file path on session_start to
// Tempest's hook Unix socket so Tempest can resume the same session on
// restart. Runs inside Pi's process (not Tempest's), loaded via jiti.

import * as net from "node:net";

interface PiSessionManager {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getHeader(): { cwd?: string } | null;
}

interface PiExtensionContext {
  sessionManager: PiSessionManager;
}

interface PiSessionStartEvent {
  reason?: string;
  previousSessionFile?: string;
}

interface PiExtensionAPI {
  on(
    event: "session_start",
    handler: (
      event: PiSessionStartEvent,
      ctx: PiExtensionContext,
    ) => void | Promise<void>,
  ): void;
}

export default function (pi: PiExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    const socketPath = process.env.TEMPEST_HOOK_SOCKET;
    if (!socketPath) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return; // ephemeral session, nothing to persist

    const payload = {
      event_type: "pi_session_start",
      pid: process.pid,
      session_id: ctx.sessionManager.getSessionId(),
      transcript_path: sessionFile,
      cwd: ctx.sessionManager.getHeader()?.cwd,
      reason: event.reason,
    };

    await new Promise<void>((resolve) => {
      const sock = net.createConnection(socketPath, () => {
        sock.end(JSON.stringify(payload) + "\n");
      });
      sock.once("close", () => resolve());
      sock.once("error", () => resolve());
    });
  });
}
