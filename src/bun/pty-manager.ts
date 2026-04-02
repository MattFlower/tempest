import { statSync } from "node:fs";

interface PtyInstance {
  id: string;
  proc: ReturnType<typeof Bun.spawn>;
}

type OutputCallback = (id: string, data: string, seq: number) => void;
type ExitCallback = (id: string, exitCode: number) => void;

export class PtyManager {
  private terminals = new Map<string, PtyInstance>();
  private outputCallbacks: OutputCallback[] = [];
  private exitCallbacks: ExitCallback[] = [];

  // Microtask-based coalescing: batch all synchronous PTY output within
  // a single event loop tick (~0ms added latency).
  private outputBuffers = new Map<string, Uint8Array[]>();
  private pendingFlush = new Set<string>();

  // Sequence counter per terminal for ordered delivery
  private seqCounters = new Map<string, number>();

  onOutput(cb: OutputCallback) {
    this.outputCallbacks.push(cb);
  }

  onExit(cb: ExitCallback) {
    this.exitCallbacks.push(cb);
  }

  private emitOutput(id: string, data: Uint8Array | string) {
    const chunk =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const existing = this.outputBuffers.get(id) || [];
    existing.push(chunk);
    this.outputBuffers.set(id, existing);

    if (!this.pendingFlush.has(id)) {
      this.pendingFlush.add(id);
      queueMicrotask(() => {
        this.flushOutput(id);
      });
    }
  }

  private flushOutput(id: string) {
    this.pendingFlush.delete(id);
    const chunks = this.outputBuffers.get(id);
    if (chunks && chunks.length > 0) {
      this.outputBuffers.delete(id);

      const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }

      const b64 = Buffer.from(merged).toString("base64");

      const seq = (this.seqCounters.get(id) ?? 0) + 1;
      this.seqCounters.set(id, seq);

      for (const cb of this.outputCallbacks) {
        cb(id, b64, seq);
      }
    }
  }

  create(params: {
    id: string;
    command: string[];
    cwd: string;
    env?: Record<string, string>;
    cols: number;
    rows: number;
  }): { success: boolean; error?: string } {
    if (this.terminals.has(params.id)) {
      return { success: false, error: `Terminal ${params.id} already exists` };
    }

    try {
      try {
        const stat = statSync(params.cwd);
        if (!stat.isDirectory()) {
          return { success: false, error: `cwd is not a directory: ${params.cwd}` };
        }
      } catch {
        return { success: false, error: `cwd does not exist: ${params.cwd}` };
      }
      const id = params.id;
      this.seqCounters.set(id, 0);

      const proc = Bun.spawn(params.command, {
        cwd: params.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TERM_PROGRAM: "tempest",
          TERM_PROGRAM_VERSION: "0.1.0",
          // Clear terminal-specific env vars so shells and CLI tools don't
          // activate integrations for features xterm.js doesn't support.
          // These cause OSC/DCS sequences that leak as stray characters.
          GHOSTTY_RESOURCES_DIR: "",
          GHOSTTY_SHELL_INTEGRATION_NO_SUDO: "",
          GHOSTTY_BIN_DIR: "",
          ITERM_SESSION_ID: "",
          ITERM_PROFILE: "",
          TERM_SESSION_ID: "",
          LC_TERMINAL: "",
          LC_TERMINAL_VERSION: "",
          VTE_VERSION: "",
          WT_SESSION: "",
          WT_PROFILE_ID: "",
          KONSOLE_DBUS_SESSION: "",
          KONSOLE_VERSION: "",
          ...params.env,
        },
        terminal: {
          cols: params.cols,
          rows: params.rows,
          data: (_terminal: any, data: any) => {
            if (typeof data === "string") {
              this.emitOutput(id, data);
            } else {
              this.emitOutput(id, new Uint8Array(data));
            }
          },
        },
        onExit: (_proc: any, exitCode: number | null) => {
          this.flushOutput(id);
          this.terminals.delete(id);
          this.seqCounters.delete(id);
          this.outputBuffers.delete(id);
          this.pendingFlush.delete(id);
          for (const cb of this.exitCallbacks) {
            cb(id, exitCode ?? -1);
          }
        },
      });

      this.terminals.set(id, { id, proc });
      console.log(
        `[pty] Created terminal "${id}": ${params.command.join(" ")} (${params.cols}x${params.rows})`,
      );
      return { success: true };
    } catch (e) {
      console.error(`[pty] Failed to create terminal "${params.id}":`, e);
      return { success: false, error: String(e) };
    }
  }

  write(id: string, data: string) {
    const terminal = this.terminals.get(id);
    if (terminal?.proc.terminal) {
      terminal.proc.terminal.write(data);
    }
  }

  resize(id: string, cols: number, rows: number) {
    const terminal = this.terminals.get(id);
    if (terminal?.proc.terminal) {
      terminal.proc.terminal.resize(cols, rows);
    }
  }

  kill(id: string) {
    const terminal = this.terminals.get(id);
    if (terminal) {
      console.log(`[pty] Killing terminal "${id}"`);
      this.flushOutput(id);
      terminal.proc.terminal?.close();
      terminal.proc.kill();
      this.terminals.delete(id);
      this.seqCounters.delete(id);
      this.outputBuffers.delete(id);
      this.pendingFlush.delete(id);
    }
  }

  /** Get the PID of the process running in a terminal. */
  getPid(id: string): number | undefined {
    return this.terminals.get(id)?.proc.pid;
  }

  /** Find the terminal ID that owns a given PID (reverse lookup). */
  findTerminalByPid(pid: number): string | undefined {
    for (const [id, instance] of this.terminals) {
      if (instance.proc.pid === pid) return id;
    }
    return undefined;
  }

  killAll() {
    for (const id of this.terminals.keys()) {
      this.kill(id);
    }
  }
}
