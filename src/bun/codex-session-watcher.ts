// ============================================================
// Codex Session Watcher
//
// Codex (unlike Claude and Pi) has no hook or extension API that can
// tell Tempest which session a given PTY belongs to. Instead it writes
// a rollout file to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` on
// launch. We recursively watch that tree and, when a new rollout
// appears, read its `session_meta` header and match its `cwd` to a
// live Tempest terminal.
//
// The match is best-effort: if two Codex terminals launch in the same
// cwd within the fs-watch debounce window the assignment can swap.
// ============================================================

import {
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname } from "node:path";
import { parseSessionHeader } from "./history/codex-jsonl-parser";
import { extractSessionIdFromFilename } from "./history/codex-metadata-cache";

export interface CodexRolloutDiscovery {
  sessionId: string;
  cwd: string;
  filePath: string;
}

const HEADER_READ_BYTES = 16384;

export class CodexSessionWatcher {
  private readonly root: string;
  private watcher: FSWatcher | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  /** Files we've already reported, keyed by absolute path. */
  private reported = new Set<string>();
  /** Files currently being parsed (retry chain in flight). */
  private inFlight = new Set<string>();
  /** Most recent session id discovered per cwd (for enrichment on restart). */
  private latestByCwd = new Map<string, { sessionId: string; mtimeMs: number }>();
  private onDiscovery?: (event: CodexRolloutDiscovery) => void;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), ".codex", "sessions");
  }

  start(onDiscovery: (event: CodexRolloutDiscovery) => void): void {
    if (this.shuttingDown) return;
    this.onDiscovery = onDiscovery;

    try {
      mkdirSync(this.root, { recursive: true });
    } catch (err) {
      this.scheduleRetry(err);
      return;
    }

    // Seed latestByCwd with the newest rollout per cwd so restart-time
    // lookups by cwd have something to return even for sessions created
    // before Tempest started.
    this.seedLatestByCwd();

    try {
      this.watcher = watch(this.root, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        const short = typeof filename === "string" ? filename : filename.toString();
        const base = basename(short);
        if (!base.startsWith("rollout-") || extname(base) !== ".jsonl") return;
        const fullPath = join(this.root, short);
        if (this.reported.has(fullPath)) return;
        this.handleRollout(fullPath);
      });
      this.watcher.on("error", (err) => {
        console.error("[codex-watcher] watch error:", err);
        try { this.watcher?.close(); } catch {}
        this.watcher = null;
        this.scheduleRetry(err);
      });
      console.log(`[codex-watcher] Watching ${this.root}`);
    } catch (err) {
      this.watcher = null;
      this.scheduleRetry(err);
    }
  }

  stop(): void {
    this.shuttingDown = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try { this.watcher?.close(); } catch {}
    this.watcher = null;
  }

  /**
   * Return the most recently observed Codex session id for a given cwd,
   * if any. Used to hydrate persisted Codex tabs on startup when the
   * rollout predates the watcher.
   */
  lookupLatestByCwd(cwd: string): string | undefined {
    return this.latestByCwd.get(cwd)?.sessionId;
  }

  private scheduleRetry(reason: unknown): void {
    if (this.shuttingDown || this.retryTimer) return;
    console.warn("[codex-watcher] Retrying start in 5s:", reason);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.onDiscovery) this.start(this.onDiscovery);
    }, 5000);
  }

  private handleRollout(fullPath: string): void {
    // fs.watch can fire several times for the same new file (rename +
    // subsequent change events as codex flushes). Dedupe by path so we
    // don't spawn parallel retry chains that could each report success
    // and double-fire onDiscovery.
    if (this.inFlight.has(fullPath)) return;
    this.inFlight.add(fullPath);

    // fs.watch often fires before the file is fully written. Retry a
    // few times with a small backoff until the header parses.
    let attempts = 0;
    const tryParse = (): void => {
      attempts++;
      const header = readHeader(fullPath);
      if (!header || !header.cwd) {
        if (attempts < 5) {
          setTimeout(tryParse, 150 * attempts);
        } else {
          this.inFlight.delete(fullPath);
        }
        return;
      }

      this.inFlight.delete(fullPath);

      const sessionId = header.id ?? extractSessionIdFromFilename(fullPath);
      if (!sessionId) return;

      let mtimeMs = Date.now();
      try {
        mtimeMs = statSync(fullPath).mtimeMs;
      } catch { /* ignore */ }

      this.reported.add(fullPath);
      const existing = this.latestByCwd.get(header.cwd);
      if (!existing || existing.mtimeMs < mtimeMs) {
        this.latestByCwd.set(header.cwd, { sessionId, mtimeMs });
      }
      this.onDiscovery?.({ sessionId, cwd: header.cwd, filePath: fullPath });
    };

    tryParse();
  }

  private seedLatestByCwd(): void {
    if (!existsSync(this.root)) return;
    const rollouts: Array<{ path: string; mtimeMs: number }> = [];
    walk(this.root, rollouts);
    rollouts.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const { path, mtimeMs } of rollouts) {
      const header = readHeader(path);
      if (!header || !header.cwd) continue;
      const sessionId = header.id ?? extractSessionIdFromFilename(path);
      if (!sessionId) continue;
      this.latestByCwd.set(header.cwd, { sessionId, mtimeMs });
      this.reported.add(path);
    }
  }
}

function readHeader(
  filePath: string,
): ReturnType<typeof parseSessionHeader> | undefined {
  try {
    const buf = new Uint8Array(HEADER_READ_BYTES);
    const fd = openSync(filePath, "r");
    let bytesRead = 0;
    try {
      bytesRead = readSync(fd, buf, 0, HEADER_READ_BYTES, 0);
    } finally {
      closeSync(fd);
    }
    const text = new TextDecoder().decode(buf.subarray(0, bytesRead));
    const newlineIdx = text.indexOf("\n");
    const firstLine = newlineIdx >= 0 ? text.slice(0, newlineIdx) : text;
    if (!firstLine.trim()) return undefined;
    return parseSessionHeader(firstLine);
  } catch {
    return undefined;
  }
}

function walk(
  dir: string,
  out: Array<{ path: string; mtimeMs: number }>,
): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip symlinks to avoid loops if a user has accidentally made
    // ~/.codex/sessions/some-link -> ~/.codex/sessions itself.
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.isFile() &&
      entry.name.startsWith("rollout-") &&
      extname(entry.name) === ".jsonl"
    ) {
      try {
        const s = statSync(full);
        out.push({ path: full, mtimeMs: s.mtimeMs });
      } catch { /* ignore */ }
    }
  }
}
