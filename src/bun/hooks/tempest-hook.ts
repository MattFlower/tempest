#!/usr/bin/env bun
// TempestHook — called by Claude Code hook events
// Usage: bun tempest-hook.ts <event_type> <socket_path>
// Reads JSON from stdin, injects event_type and pid, sends to Unix socket.
// Always exits 0 — must never block Claude.

try {
  const eventType = process.argv[2];
  const socketPath = process.argv[3];

  if (!eventType || !socketPath) process.exit(0);

  // Quick-exit if socket doesn't exist
  const { existsSync } = await import("node:fs");
  if (!existsSync(socketPath)) process.exit(0);

  // Read stdin
  const stdinText = await Bun.stdin.text();
  let payload: Record<string, unknown> = {};

  if (stdinText.trim()) {
    try {
      payload = JSON.parse(stdinText);
    } catch {
      // Use empty payload if stdin isn't valid JSON
    }
  }

  // Inject event_type and pid (ppid = Claude's PID, since hook runs as child)
  payload.event_type = eventType;
  payload.pid = process.ppid;

  const message = JSON.stringify(payload) + "\n";

  // Connect to Unix socket and send
  await new Promise<void>((resolve) => {
    const socket = Bun.connect({
      unix: socketPath,
      socket: {
        open(sock) {
          sock.write(message);
          sock.end();
        },
        data() {},
        close() {
          resolve();
        },
        error() {
          resolve();
        },
        connectError() {
          resolve();
        },
      },
    }).catch(() => resolve());
  });
} catch {
  // Never throw — always exit cleanly
}

process.exit(0);
