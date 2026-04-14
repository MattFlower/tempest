import type { ServerWebSocket } from "bun";

export interface TermWsData {
  terminalId: string;
  allowWrite: boolean;
}

type TermWs = ServerWebSocket<TermWsData>;

export class RemoteTerminalHub {
  private subscribers = new Map<string, Set<TermWs>>();

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
    if (set.size === 0) this.subscribers.delete(id);
  }

  broadcast(id: string, data: string, seq: number): void {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;
    const frame = JSON.stringify({ type: "output", data, seq });
    for (const ws of set) {
      try {
        ws.send(frame);
      } catch {
        // ignore send failures; close handler will clean up
      }
    }
  }

  notifyExit(id: string, exitCode: number): void {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;
    const frame = JSON.stringify({ type: "exit", exitCode });
    for (const ws of set) {
      try {
        ws.send(frame);
        ws.close();
      } catch {
        // ignore
      }
    }
    this.subscribers.delete(id);
  }
}
