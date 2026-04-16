import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RemoteTerminalHub, type TermWsData } from "./remote-terminal-hub";
import type { ServerWebSocket } from "bun";

type TermWs = ServerWebSocket<TermWsData>;

/** Create a minimal mock that satisfies the TermWs shape used by the hub. */
function makeMockWs(
  opts: { sendReturn?: number; sendThrows?: boolean; closeThrows?: boolean } = {},
): TermWs & { send: ReturnType<typeof mock>; close: ReturnType<typeof mock> } {
  const { sendReturn = 1, sendThrows = false, closeThrows = false } = opts;

  const ws = {
    data: { terminalId: "", allowWrite: false },
    send: mock(() => {
      if (sendThrows) throw new Error("socket dead");
      return sendReturn;
    }),
    close: mock(() => {
      if (closeThrows) throw new Error("close failed");
    }),
  };
  return ws as any;
}

describe("RemoteTerminalHub", () => {
  let hub: RemoteTerminalHub;

  beforeEach(() => {
    hub = new RemoteTerminalHub();
  });

  afterEach(() => {
    // Suppress rate-limit state leaking across tests
    (hub as any).lastWarnTime.clear();
  });

  test("broadcast delivers frames to all attached subscribers", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    hub.attach("t1", ws1 as any);
    hub.attach("t1", ws2 as any);
    hub.broadcast("t1", "aGVsbG8=", 1);

    const expected = JSON.stringify({ type: "output", data: "aGVsbG8=", seq: 1 });
    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
  });

  test("broadcast evicts subscribers when send returns 0 (dropped)", () => {
    const good = makeMockWs({ sendReturn: 5 });
    const dropped = makeMockWs({ sendReturn: 0 });

    hub.attach("t1", good as any);
    hub.attach("t1", dropped as any);
    hub.broadcast("t1", "data", 1);

    expect(dropped.close).toHaveBeenCalledTimes(1);

    // Second broadcast should not attempt the evicted socket
    hub.broadcast("t1", "data", 2);
    expect(dropped.send).toHaveBeenCalledTimes(1); // only the first attempt
    expect(good.send).toHaveBeenCalledTimes(2);
  });

  test("broadcast evicts subscribers when send returns -1 (backpressure)", () => {
    const backpressure = makeMockWs({ sendReturn: -1 });

    hub.attach("t1", backpressure as any);
    hub.broadcast("t1", "data", 1);

    expect(backpressure.close).toHaveBeenCalledTimes(1);

    // Subscriber set should be empty now, so map entry is cleaned up
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("broadcast evicts subscribers when send throws", () => {
    const throwing = makeMockWs({ sendThrows: true });

    hub.attach("t1", throwing as any);
    hub.broadcast("t1", "data", 1);

    expect(throwing.close).toHaveBeenCalledTimes(1);
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("broadcast handles close() throwing on stale socket", () => {
    const ws = makeMockWs({ sendReturn: 0, closeThrows: true });

    hub.attach("t1", ws as any);
    // Should not throw even though close() throws
    hub.broadcast("t1", "data", 1);

    expect(ws.close).toHaveBeenCalledTimes(1);
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("broadcast is a no-op for unknown terminal ids", () => {
    // Should not throw
    hub.broadcast("nonexistent", "data", 1);
  });

  test("notifyExit sends exit frame and closes all subscribers", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    hub.attach("t1", ws1 as any);
    hub.attach("t1", ws2 as any);
    hub.notifyExit("t1", 0);

    const expected = JSON.stringify({ type: "exit", exitCode: 0 });
    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
    expect(ws1.close).toHaveBeenCalledTimes(1);
    expect(ws2.close).toHaveBeenCalledTimes(1);

    // Subscriber map should be cleaned up
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("notifyExit is best-effort: ignores send failures", () => {
    const dead = makeMockWs({ sendReturn: 0 });

    hub.attach("t1", dead as any);
    // Should not throw even though send fails
    hub.notifyExit("t1", 1);

    expect(dead.close).toHaveBeenCalledTimes(1);
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("detach removes a subscriber and cleans up empty sets", () => {
    const ws = makeMockWs();

    hub.attach("t1", ws as any);
    expect((hub as any).subscribers.has("t1")).toBeTrue();

    hub.detach("t1", ws as any);
    expect((hub as any).subscribers.has("t1")).toBeFalse();
  });

  test("detach is safe for unknown terminal or socket", () => {
    const ws = makeMockWs();
    // Neither of these should throw
    hub.detach("nonexistent", ws as any);
    hub.attach("t1", ws as any);
    hub.detach("t1", makeMockWs() as any); // different socket
    expect((hub as any).subscribers.get("t1")?.size).toBe(1);
  });

  test("stale-subscriber warning is rate-limited per terminal", () => {
    const originalWarn = console.warn;
    const warnMock = mock(() => {});
    console.warn = warnMock as any;

    try {
      (RemoteTerminalHub as any).WARN_INTERVAL_MS = 60_000;

      // Keep a healthy subscriber alive so the set (and lastWarnTime) survive eviction.
      const healthy = makeMockWs({ sendReturn: 5 });
      const stale1 = makeMockWs({ sendReturn: 0 });
      const stale2 = makeMockWs({ sendReturn: 0 });

      hub.attach("t1", healthy as any);
      hub.attach("t1", stale1 as any);
      hub.broadcast("t1", "data", 1);
      // First broadcast with a stale socket triggers a warning
      expect(warnMock).toHaveBeenCalledTimes(1);

      hub.attach("t1", stale2 as any);
      hub.broadcast("t1", "data", 2);
      // Second broadcast within the interval should NOT warn again
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
      (RemoteTerminalHub as any).WARN_INTERVAL_MS = 5_000;
    }
  });
});
