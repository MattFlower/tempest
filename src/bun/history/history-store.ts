// ============================================================
// History Store — Port of HistoryStore.swift
// Facade coordinating metadata cache + ripgrep searcher.
// 30s refresh timer for background scanning.
// ============================================================

import { homedir } from "node:os";
import { join } from "node:path";
import {
  HistoryMetadataCache,
  encodeWorkspacePath,
  type SessionSummaryData,
  type CachedSession,
} from "./metadata-cache";
import { RipgrepSearcher } from "./ripgrep-searcher";
import { parseFile, type ParsedMessage } from "./jsonl-parser";
import type { SessionSummary, SessionMessage, ToolCallInfo } from "../../shared/ipc-types";
import type { SessionHistoryProvider } from "./session-history-provider";

interface ParseCacheEntry {
  mtime: number;
  messages: ParsedMessage[];
}

interface EditIndexEntry {
  mtime: number;
  fullPaths: Set<string>;
  baseNames: Set<string>;
  summaries: string[];
}

const MAX_PARSE_CACHE_ENTRIES = 300;
const MAX_EDIT_INDEX_ENTRIES = 1000;

const CLAUDE_PROJECTS_ROOT = join(homedir(), ".claude", "projects");

export class HistoryStore implements SessionHistoryProvider {
  readonly providerId = "claude" as const;

  private readonly cache: HistoryMetadataCache;
  private readonly searcher: RipgrepSearcher;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private parseCache = new Map<string, ParseCacheEntry>();
  private editIndex = new Map<string, EditIndexEntry>();

  get isSearchAvailable(): boolean {
    return this.searcher.isAvailable;
  }

  constructor() {
    this.cache = new HistoryMetadataCache();
    this.searcher = new RipgrepSearcher();
  }

  // --- Initialization ---

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.cache.load();
    this.cache.scan();
    this.pruneDerivedCaches();
    await this.cache.save();
    this.initialized = true;
  }

  // --- Session Listing ---

  async getSessions(
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();
    return this.cache.sessions(scope, workspacePath).map(toSessionSummary);
  }

  // --- Search ---

  async searchSessions(
    query: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    if (!this.searcher.isAvailable) {
      // Fallback: filter cached sessions by title
      return this.cache
        .sessions(scope, workspacePath)
        .filter((s) =>
          s.firstPrompt.toLowerCase().includes(query.toLowerCase()),
        )
        .map(toSessionSummary);
    }

    const encodedProjectPath = workspacePath
      ? encodeWorkspacePath(workspacePath)
      : undefined;
    const filePaths = await this.searcher.search(
      query,
      scope,
      encodedProjectPath,
    );
    const summaries: SessionSummary[] = [];

    for (const path of filePaths) {
      const cached = this.cache.sessionByFilePath(path);
      if (cached) {
        summaries.push({
          filePath: cached.filePath,
          firstPrompt: cached.firstPrompt ?? "Untitled Session",
          createdAt: cached.createdAt,
          modifiedAt: cached.modifiedAt,
          gitBranch: cached.gitBranch,
        });
      }
    }

    return summaries.sort((a, b) =>
      (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
    );
  }

  // --- Messages ---

  async getMessages(sessionFilePath: string): Promise<SessionMessage[]> {
    const cachedSession = this.cache.sessionByFilePath(sessionFilePath);
    try {
      const parsed = cachedSession
        ? await this.getParsedForSession(cachedSession)
        : await parseFile(sessionFilePath);
      return parsed.map((msg, index) => toSessionMessage(msg, index));
    } catch {
      return [];
    }
  }

  ownsSessionFile(sessionFilePath: string): boolean {
    return sessionFilePath.startsWith(CLAUDE_PROJECTS_ROOT);
  }

  // --- File-specific search (for AI Context) ---

  async sessionsWithToolCallsForFile(
    filePath: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    const fileName = filePath.split("/").pop() ?? filePath;
    const allSessions = this.cache.sessions(scope, workspacePath);
    const matching: SessionSummary[] = [];

    for (const summary of allSessions) {
      const session = this.cache.sessionByFilePath(summary.filePath);
      if (!session) continue;
      try {
        const index = await this.getEditIndexForSession(session);
        const hasEdit =
          index.fullPaths.has(filePath) ||
          index.baseNames.has(fileName) ||
          index.summaries.some(
            (s) => s.includes(filePath) || s.includes(fileName),
          );

        if (hasEdit) {
          matching.push(toSessionSummary(summary));
        }
      } catch {
        // Skip unreadable sessions
      }
    }

    return matching.sort((a, b) =>
      (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
    );
  }

  // --- Caches keyed by session file mtime ---

  private async getParsedForSession(
    session: CachedSession,
  ): Promise<ParsedMessage[]> {
    const cached = this.parseCache.get(session.filePath);
    if (cached && cached.mtime === session.fileMtime) {
      this.touchEntry(this.parseCache, session.filePath, cached);
      return cached.messages;
    }
    const messages = await parseFile(session.filePath);
    const entry: ParseCacheEntry = {
      mtime: session.fileMtime,
      messages,
    };
    this.touchEntry(this.parseCache, session.filePath, entry);
    this.pruneMapToLimit(this.parseCache, MAX_PARSE_CACHE_ENTRIES);
    return messages;
  }

  private async getEditIndexForSession(
    session: CachedSession,
  ): Promise<EditIndexEntry> {
    const cached = this.editIndex.get(session.filePath);
    if (cached && cached.mtime === session.fileMtime) {
      this.touchEntry(this.editIndex, session.filePath, cached);
      return cached;
    }

    const messages = await this.getParsedForSession(session);
    const fullPaths = new Set<string>();
    const baseNames = new Set<string>();
    const summaries: string[] = [];

    for (const msg of messages) {
      if (msg.type !== "assistant") continue;
      for (const tc of msg.toolCalls) {
        if (tc.name !== "Edit" && tc.name !== "Write") continue;
        summaries.push(tc.inputSummary);
        if (tc.fullInput) {
          try {
            const parsed = JSON.parse(tc.fullInput);
            const p = parsed.file_path;
            if (typeof p === "string") {
              fullPaths.add(p);
              const base = p.split("/").pop();
              if (base) baseNames.add(base);
            }
          } catch {
            // fullInput isn't pure JSON — fall back to summary match
          }
        }
      }
    }

    const entry: EditIndexEntry = {
      mtime: session.fileMtime,
      fullPaths,
      baseNames,
      summaries,
    };
    this.touchEntry(this.editIndex, session.filePath, entry);
    this.pruneMapToLimit(this.editIndex, MAX_EDIT_INDEX_ENTRIES);
    return entry;
  }

  // --- Refresh ---

  async refresh(): Promise<void> {
    this.cache.scan();
    this.pruneDerivedCaches();
    await this.cache.save();
  }

  private pruneDerivedCaches(): void {
    const livePaths = new Set(
      this.cache.sessions("all").map((session) => session.filePath),
    );

    for (const path of this.parseCache.keys()) {
      if (!livePaths.has(path)) {
        this.parseCache.delete(path);
      }
    }

    for (const path of this.editIndex.keys()) {
      if (!livePaths.has(path)) {
        this.editIndex.delete(path);
      }
    }

    this.pruneMapToLimit(this.parseCache, MAX_PARSE_CACHE_ENTRIES);
    this.pruneMapToLimit(this.editIndex, MAX_EDIT_INDEX_ENTRIES);
  }

  private touchEntry<T>(map: Map<string, T>, key: string, value: T): void {
    if (map.has(key)) {
      map.delete(key);
    }
    map.set(key, value);
  }

  private pruneMapToLimit<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) {
      const oldestKey = map.keys().next().value as string | undefined;
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
  }

  startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        console.error("[HistoryStore] refresh error:", err);
      }
    }, 30_000);
  }

  stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

// --- Mapping helpers ---

function toSessionSummary(data: SessionSummaryData): SessionSummary {
  return {
    filePath: data.filePath,
    firstPrompt: data.firstPrompt,
    createdAt: data.createdAt,
    modifiedAt: data.modifiedAt,
    gitBranch: data.gitBranch,
  };
}

function toSessionMessage(msg: ParsedMessage, index: number): SessionMessage {
  return {
    type: msg.type as "user" | "assistant" | "system",
    text: msg.textContent ?? "",
    toolCalls: msg.toolCalls.map(
      (tc): ToolCallInfo => ({
        tool: tc.name,
        summary: tc.inputSummary,
        input: tc.fullInput,
        inputParamCount: tc.inputParamCount,
      }),
    ),
    timestamp: msg.timestamp,
  };
}
