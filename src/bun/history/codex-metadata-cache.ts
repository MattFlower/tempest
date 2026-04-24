// ============================================================
// Codex History Metadata Cache
//
// Scans `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (date-nested)
// and caches lightweight per-session metadata (first prompt, cwd,
// timestamps, session id) in `~/.config/tempest/codex-history-cache.json`.
//
// Like the Pi cache, the authoritative workspace path comes from the
// `session_meta` header at the top of every rollout. Session id is
// likewise carried by the header.
// ============================================================

import {
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname, relative, dirname } from "node:path";
import { parseLine } from "./codex-jsonl-parser";
import { CODEX_HISTORY_CACHE_FILE } from "../config/paths";

export interface CodexCachedSession {
  /** Unique cache key: relative path of the rollout file under sessions root. */
  sessionId: string;
  /** Codex session UUID pulled from the session_meta header. */
  codexSessionId?: string;
  /** Absolute `cwd` extracted from the session header, when available. */
  workspacePath?: string;
  /** Absolute path to the `.jsonl` file. */
  filePath: string;
  fileMtime: number;
  fileSize: number;
  firstPrompt?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface CodexSessionSummaryData {
  filePath: string;
  firstPrompt: string;
  createdAt?: string;
  modifiedAt?: string;
  gitBranch?: string;
  /** Codex session UUID for `codex resume <uuid>`. */
  codexSessionId?: string;
}

export class CodexHistoryMetadataCache {
  private readonly sessionsDir: string;
  private readonly cacheFilePath: string;
  private entries = new Map<string, CodexCachedSession>();
  private pathIndex = new Map<string, string>();

  constructor(sessionsDir?: string, cacheFilePath?: string) {
    this.sessionsDir =
      sessionsDir ?? join(homedir(), ".codex", "sessions");
    this.cacheFilePath = cacheFilePath ?? CODEX_HISTORY_CACHE_FILE;
  }

  async load(): Promise<void> {
    const file = Bun.file(this.cacheFilePath);
    if (!(await file.exists())) return;
    try {
      const data = (await file.json()) as Record<string, CodexCachedSession>;
      this.entries = new Map(Object.entries(data));
      this.rebuildPathIndex();
    } catch {
      // Corrupt cache — start fresh
    }
  }

  async save(): Promise<void> {
    const dir = join(this.cacheFilePath, "..");
    mkdirSync(dir, { recursive: true });
    const obj: Record<string, CodexCachedSession> = {};
    for (const [k, v] of this.entries) {
      obj[k] = v;
    }
    await Bun.write(this.cacheFilePath, JSON.stringify(obj, null, 2));
  }

  scan(): void {
    if (!existsSync(this.sessionsDir)) return;

    const previousEntries = new Map(this.entries);
    const newEntries = new Map<string, CodexCachedSession>();
    const newPathIndex = new Map<string, string>();

    const rolloutPaths: string[] = [];
    this.walkForRollouts(this.sessionsDir, rolloutPaths);

    for (const filePath of rolloutPaths) {
      const sessionId = relative(this.sessionsDir, filePath);

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }

      const mtime = stat.mtimeMs;
      const fileSize = stat.size;

      const existing = previousEntries.get(sessionId);
      if (
        existing &&
        existing.fileMtime === mtime &&
        existing.fileSize === fileSize
      ) {
        newEntries.set(sessionId, existing);
        newPathIndex.set(existing.filePath, sessionId);
        continue;
      }

      const metadata = this.extractMetadata(filePath);
      const modifiedAt = new Date(mtime).toISOString();

      newEntries.set(sessionId, {
        sessionId,
        codexSessionId: metadata.codexSessionId,
        workspacePath: metadata.workspacePath,
        filePath,
        fileMtime: mtime,
        fileSize,
        firstPrompt: metadata.firstPrompt,
        createdAt: metadata.createdAt,
        modifiedAt,
      });
      newPathIndex.set(filePath, sessionId);
    }

    this.entries = newEntries;
    this.pathIndex = newPathIndex;
  }

  sessions(
    scope: "all" | "project",
    workspacePath?: string,
  ): CodexSessionSummaryData[] {
    const filtered: CodexCachedSession[] = [];

    for (const entry of this.entries.values()) {
      if (scope === "project") {
        if (!workspacePath) continue;
        if (entry.workspacePath !== workspacePath) continue;
      }
      filtered.push(entry);
    }

    return filtered
      .map((entry) => ({
        filePath: entry.filePath,
        firstPrompt: entry.firstPrompt ?? "Untitled Session",
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
        gitBranch: undefined,
        codexSessionId: entry.codexSessionId,
      }))
      .sort((a, b) =>
        (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
      );
  }

  sessionByFilePath(path: string): CodexCachedSession | undefined {
    const sessionId = this.pathIndex.get(path);
    if (!sessionId) return undefined;
    return this.entries.get(sessionId);
  }

  /** Returns the set of dates (relative subdirs) that hold sessions for `workspacePath`. */
  projectDirsForWorkspace(workspacePath: string): string[] {
    const dirs = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.workspacePath === workspacePath) {
        // entry.sessionId is the relative path; take its directory so ripgrep
        // can scope to the date-nested folder rather than the whole tree.
        dirs.add(dirname(entry.sessionId));
      }
    }
    return Array.from(dirs);
  }

  get rootDir(): string {
    return this.sessionsDir;
  }

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const [sessionId, entry] of this.entries) {
      this.pathIndex.set(entry.filePath, sessionId);
    }
  }

  /** Depth-first walk collecting rollout-*.jsonl files. */
  private walkForRollouts(root: string, out: string[]): void {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        this.walkForRollouts(full, out);
      } else if (entry.isFile()) {
        if (
          extname(entry.name) === ".jsonl" &&
          basename(entry.name).startsWith("rollout-")
        ) {
          out.push(full);
        }
      }
    }
  }

  private extractMetadata(filePath: string): {
    firstPrompt?: string;
    createdAt?: string;
    workspacePath?: string;
    codexSessionId?: string;
  } {
    let text: string;
    try {
      const buffer = new Uint8Array(262144);
      const fd = openSync(filePath, "r");
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buffer, 0, 262144, 0);
      } finally {
        closeSync(fd);
      }
      text = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    } catch {
      return {};
    }

    const lines = text.split("\n");
    let firstPrompt: string | undefined;
    let createdAt: string | undefined;
    let workspacePath: string | undefined;
    let codexSessionId: string | undefined;

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      const result = parseLine(line);
      if (result.kind === "header") {
        workspacePath ??= result.cwd;
        createdAt ??= result.timestamp;
        codexSessionId ??= result.id;
        continue;
      }
      if (result.kind !== "message") continue;

      const msg = result.message;
      createdAt ??= msg.timestamp;
      if (
        !firstPrompt &&
        msg.type === "user" &&
        msg.textContent
      ) {
        const trimmedText = msg.textContent.trim();
        if (!trimmedText.startsWith("<")) {
          firstPrompt = trimmedText;
        }
      }

      if (firstPrompt && createdAt && workspacePath && codexSessionId) break;
    }

    return { firstPrompt, createdAt, workspacePath, codexSessionId };
  }
}

// Fall back to the filename-derived UUID when the header is missing.
export function extractSessionIdFromFilename(
  filePath: string,
): string | undefined {
  const base = basename(filePath, ".jsonl");
  // Pattern: rollout-<timestamp>-<uuid>
  const match = /rollout-.+?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    base,
  );
  return match?.[1]?.toLowerCase();
}
