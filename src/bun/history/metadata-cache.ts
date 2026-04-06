// ============================================================
// History Metadata Cache — Port of HistoryMetadataCache.swift
// Scans ~/.claude/projects/ for JSONL files, caches metadata,
// persists to ~/.config/tempest/history-cache.json.
// ============================================================

import { mkdirSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname } from "node:path";
import { parseLine } from "./jsonl-parser";
import { HISTORY_CACHE_FILE } from "../config/paths";

export interface CachedSession {
  sessionId: string;
  projectPath: string; // encoded path (directory name)
  filePath: string; // absolute path to .jsonl
  fileMtime: number; // mtime in ms
  fileSize: number;
  firstPrompt?: string;
  createdAt?: string;
  modifiedAt?: string; // derived from file mtime as ISO8601
  gitBranch?: string;
}

export class HistoryMetadataCache {
  private readonly claudeDir: string;
  private readonly cacheFilePath: string;
  private entries = new Map<string, CachedSession>();
  private pathIndex = new Map<string, string>(); // filePath -> sessionId

  constructor(claudeDir?: string, cacheFilePath?: string) {
    this.claudeDir = claudeDir ?? join(homedir(), ".claude");
    this.cacheFilePath = cacheFilePath ?? HISTORY_CACHE_FILE;
  }

  // --- Persistence ---

  async load(): Promise<void> {
    const file = Bun.file(this.cacheFilePath);
    if (!(await file.exists())) return;
    try {
      const data = (await file.json()) as Record<string, CachedSession>;
      this.entries = new Map(Object.entries(data));
      this.rebuildPathIndex();
    } catch {
      // Corrupt cache — start fresh
    }
  }

  async save(): Promise<void> {
    const dir = join(this.cacheFilePath, "..");
    mkdirSync(dir, { recursive: true });
    const obj: Record<string, CachedSession> = {};
    for (const [k, v] of this.entries) {
      obj[k] = v;
    }
    await Bun.write(this.cacheFilePath, JSON.stringify(obj, null, 2));
  }

  // --- Scanning ---

  scan(): void {
    const projectsDir = join(this.claudeDir, "projects");
    if (!existsSync(projectsDir)) return;

    const previousEntries = new Map(this.entries);
    const newEntries = new Map<string, CachedSession>();
    const newPathIndex = new Map<string, string>();

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const encodedPath of projectDirs) {
      const projectDir = join(projectsDir, encodedPath);

      let files: string[];
      try {
        files = readdirSync(projectDir).filter(
          (f) =>
            extname(f) === ".jsonl" && f !== "sessions-index.json",
        );
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(projectDir, file);
        const sessionId = basename(file, ".jsonl");

        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(filePath);
        } catch {
          continue;
        }

        const mtime = stat.mtimeMs;
        const fileSize = stat.size;

        // Check if we already have this entry with same mtime and size
        const existing = previousEntries.get(sessionId);
        if (existing && existing.fileMtime === mtime && existing.fileSize === fileSize) {
          newEntries.set(sessionId, existing);
          newPathIndex.set(existing.filePath, sessionId);
          continue;
        }

        // New or changed file: read first ~50 lines for metadata
        const metadata = this.extractMetadata(filePath);

        const modifiedAt = new Date(mtime).toISOString();

        const entry: CachedSession = {
          sessionId,
          projectPath: encodedPath,
          filePath,
          fileMtime: mtime,
          fileSize,
          firstPrompt: metadata.firstPrompt,
          createdAt: metadata.createdAt,
          modifiedAt,
          gitBranch: metadata.gitBranch,
        };
        newEntries.set(sessionId, entry);
        newPathIndex.set(filePath, sessionId);
      }
    }

    this.entries = newEntries;
    this.pathIndex = newPathIndex;
  }

  // --- Queries ---

  sessions(scope: "all" | "project", projectPath?: string): SessionSummaryData[] {
    const filtered: CachedSession[] = [];

    for (const entry of this.entries.values()) {
      if (scope === "project" && projectPath) {
        if (entry.projectPath !== projectPath) continue;
      }
      filtered.push(entry);
    }

    return filtered
      .map((entry) => ({
        filePath: entry.filePath,
        firstPrompt: entry.firstPrompt ?? "Untitled Session",
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
        gitBranch: entry.gitBranch,
      }))
      .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
  }

  sessionByFilePath(path: string): CachedSession | undefined {
    const sessionId = this.pathIndex.get(path);
    if (!sessionId) return undefined;
    return this.entries.get(sessionId);
  }

  filePathForSession(sessionId: string): string | undefined {
    return this.entries.get(sessionId)?.filePath;
  }

  // --- Private ---

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const [sessionId, entry] of this.entries) {
      this.pathIndex.set(entry.filePath, sessionId);
    }
  }

  private extractMetadata(filePath: string): {
    firstPrompt?: string;
    createdAt?: string;
    gitBranch?: string;
  } {
    // Read up to 256KB to get first ~50 lines
    let text: string;
    try {
      const buffer = new Uint8Array(262144);
      const fd = openSync(filePath, "r");
      const bytesRead = readSync(fd, buffer, 0, 262144, 0);
      closeSync(fd);
      text = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    } catch {
      return {};
    }

    const lines = text.split("\n");
    let firstPrompt: string | undefined;
    let createdAt: string | undefined;
    let gitBranch: string | undefined;

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      let result;
      try {
        result = parseLine(line);
      } catch {
        continue;
      }
      if (result.kind !== "message") continue;

      const msg = result.message;

      if (!createdAt && msg.timestamp) {
        createdAt = msg.timestamp;
      }
      if (!gitBranch && msg.gitBranch) {
        gitBranch = msg.gitBranch;
      }
      if (!firstPrompt && msg.type === "user" && msg.textContent) {
        const trimmedText = msg.textContent.trim();
        // Skip machine-generated user messages (hooks, commands, tool results)
        // which are wrapped in XML-like tags
        if (!trimmedText.startsWith("<")) {
          firstPrompt = trimmedText;
        }
      }

      // If we have all metadata, stop early
      if (firstPrompt && createdAt && gitBranch) break;
    }

    return { firstPrompt, createdAt, gitBranch };
  }
}

export interface SessionSummaryData {
  filePath: string;
  firstPrompt: string;
  createdAt?: string;
  modifiedAt?: string;
  gitBranch?: string;
}
