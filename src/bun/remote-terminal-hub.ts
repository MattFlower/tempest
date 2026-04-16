import type { ServerWebSocket } from "bun";

export interface TermWsData {
  terminalId: string;
  allowWrite: boolean;
}

type TermWs = ServerWebSocket<TermWsData>;

export class RemoteTerminalHub {
  private subscribers = new Map<string, Set<TermWs>>();
  /** Tracks last warning time per terminal to avoid flooding logs. */
  private lastWarnTime = new Map<string, number>();
  private static WARN_INTERVAL_MS = 5_000;

  attach(id: string, ws: TermWs): void {
    let set = this.subscribers.get(id);
    if (!set) {
      set = new Set();
      this.subscribers.set(id, set);
    }
    set.add(ws);
  }

  detach(id: string, ws: TermWs): void {
    const set = this.subscribers.get(id);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.subscribers.delete(id);
      this.lastWarnTime.delete(id);
    }
  }

  private sendFrame(ws: TermWs, frame: string): boolean {
    try {
      // Bun returns >0 (bytes sent), 0 (dropped), or -1 (backpressure).
      return ws.send(frame) > 0;
    } catch {
      return false;
    }
  }

  private warnStale(id: string, count: number): void {
    const now = Date.now();
    const last = this.lastWarnTime.get(id) ?? 0;
    if (now - last < RemoteTerminalHub.WARN_INTERVAL_MS) return;
    this.lastWarnTime.set(id, now);
    console.warn(
      `[remote-hub] Evicting ${count} stale subscriber(s) for terminal "${id}"`,
    );
  }

  broadcast(id: string, data: string, seq: number): void {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;

    const frame = JSON.stringify({ type: "output", data, seq });
    const stale: TermWs[] = [];

    for (const ws of set) {
      if (this.sendFrame(ws, frame)) continue;
      stale.push(ws);
    }

    if (stale.length === 0) return;
    this.warnStale(id, stale.length);
    for (const ws of stale) {
      set.delete(ws);
      try {
        ws.close();
      } catch {
        // ignore; socket will be detached if/when close event fires
      }
    }
    if (set.size === 0) {
      this.subscribers.delete(id);
      this.lastWarnTime.delete(id);
    }
  }

  notifyExit(id: string, exitCode: number): void {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;

    const frame = JSON.stringify({ type: "exit", exitCode });
    for (const ws of set) {
      this.sendFrame(ws, frame);
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    this.subscribers.delete(id);
    this.lastWarnTime.delete(id);
  }
}
