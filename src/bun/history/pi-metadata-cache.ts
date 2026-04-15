// ============================================================
// Pi History Metadata Cache
//
// Scans `~/.pi/agent/sessions/<encoded-workspace>/*.jsonl` and caches
// lightweight per-session metadata (first prompt, cwd, timestamps) in
// `~/.config/tempest/pi-history-cache.json`.
//
// Unlike Claude's cache, the authoritative workspace path comes from
// the `type:"session"` header at the top of every Pi transcript, not
// from the encoded directory name. We store both so project-scope
// filtering can match by absolute `cwd`.
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
import { join, basename, extname } from "node:path";
import { parseLine } from "./pi-jsonl-parser";
import { PI_HISTORY_CACHE_FILE } from "../config/paths";

export interface PiCachedSession {
  /** Unique cache key: `<projectDir>/<filename-without-.jsonl>`. */
  sessionId: string;
  /** Encoded subdirectory name under `~/.pi/agent/sessions`. */
  projectDir: string;
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

export interface PiSessionSummaryData {
  filePath: string;
  firstPrompt: string;
  createdAt?: string;
  modifiedAt?: string;
  gitBranch?: string;
}

export class PiHistoryMetadataCache {
  private readonly sessionsDir: string;
  private readonly cacheFilePath: string;
  private entries = new Map<string, PiCachedSession>();
  private pathIndex = new Map<string, string>();

  constructor(sessionsDir?: string, cacheFilePath?: string) {
    this.sessionsDir =
      sessionsDir ?? join(homedir(), ".pi", "agent", "sessions");
    this.cacheFilePath = cacheFilePath ?? PI_HISTORY_CACHE_FILE;
  }

  async load(): Promise<void> {
    const file = Bun.file(this.cacheFilePath);
    if (!(await file.exists())) return;
    try {
      const data = (await file.json()) as Record<string, PiCachedSession>;
      this.entries = new Map(Object.entries(data));
      this.rebuildPathIndex();
    } catch {
      // Corrupt cache — start fresh
    }
  }

  async save(): Promise<void> {
    const dir = join(this.cacheFilePath, "..");
    mkdirSync(dir, { recursive: true });
    const obj: Record<string, PiCachedSession> = {};
    for (const [k, v] of this.entries) {
      obj[k] = v;
    }
    await Bun.write(this.cacheFilePath, JSON.stringify(obj, null, 2));
  }

  scan(): void {
    if (!existsSync(this.sessionsDir)) return;

    const previousEntries = new Map(this.entries);
    const newEntries = new Map<string, PiCachedSession>();
    const newPathIndex = new Map<string, string>();

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const projectDir of projectDirs) {
      const fullProjectDir = join(this.sessionsDir, projectDir);

      let files: string[];
      try {
        files = readdirSync(fullProjectDir).filter(
          (f) => extname(f) === ".jsonl",
        );
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(fullProjectDir, file);
        const sessionId = `${projectDir}/${basename(file, ".jsonl")}`;

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
          projectDir,
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
    }

    this.entries = newEntries;
    this.pathIndex = newPathIndex;
  }

  sessions(
    scope: "all" | "project",
    workspacePath?: string,
  ): PiSessionSummaryData[] {
    const filtered: PiCachedSession[] = [];

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
      }))
      .sort((a, b) =>
        (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
      );
  }

  sessionByFilePath(path: string): PiCachedSession | undefined {
    const sessionId = this.pathIndex.get(path);
    if (!sessionId) return undefined;
    return this.entries.get(sessionId);
  }

  /** Returns the encoded project dirs whose sessions belong to `workspacePath`. */
  projectDirsForWorkspace(workspacePath: string): string[] {
    const dirs = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.workspacePath === workspacePath) {
        dirs.add(entry.projectDir);
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

  private extractMetadata(filePath: string): {
    firstPrompt?: string;
    createdAt?: string;
    workspacePath?: string;
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

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      const result = parseLine(line);
      if (result.kind === "header") {
        workspacePath ??= result.cwd;
        createdAt ??= result.timestamp;
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

      if (firstPrompt && createdAt && workspacePath) break;
    }

    return { firstPrompt, createdAt, workspacePath };
  }
}
