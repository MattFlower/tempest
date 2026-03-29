// ============================================================
// History Store — Port of HistoryStore.swift
// Facade coordinating metadata cache + ripgrep searcher.
// 30s refresh timer for background scanning.
// ============================================================

import { HistoryMetadataCache, type SessionSummaryData } from "./metadata-cache";
import { RipgrepSearcher } from "./ripgrep-searcher";
import { parseFile, type ParsedMessage } from "./jsonl-parser";
import type { SessionSummary, SessionMessage, ToolCallInfo } from "../../shared/ipc-types";

export class HistoryStore {
  private readonly cache: HistoryMetadataCache;
  private readonly searcher: RipgrepSearcher;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

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
    await this.cache.save();
    this.initialized = true;
  }

  // --- Session Listing ---

  async getSessions(
    scope: "all" | "project",
    projectPath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();
    return this.cache.sessions(scope, projectPath).map(toSessionSummary);
  }

  // --- Search ---

  async searchSessions(
    query: string,
    scope: "all" | "project",
    projectPath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    if (!this.searcher.isAvailable) {
      // Fallback: filter cached sessions by title
      return this.cache
        .sessions(scope, projectPath)
        .filter((s) =>
          s.firstPrompt.toLowerCase().includes(query.toLowerCase()),
        )
        .map(toSessionSummary);
    }

    const filePaths = await this.searcher.search(query, scope, projectPath);
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
    try {
      const parsed = await parseFile(sessionFilePath);
      return parsed.map((msg, index) => toSessionMessage(msg, index));
    } catch {
      return [];
    }
  }

  // --- File-specific search (for AI Context) ---

  async sessionsWithToolCallsForFile(
    filePath: string,
    scope: "all" | "project",
    projectPath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    const fileName = filePath.split("/").pop() ?? filePath;
    const allSessions = this.cache.sessions(scope, projectPath);
    const matching: SessionSummary[] = [];

    for (const session of allSessions) {
      try {
        const messages = await parseFile(session.filePath);
        const hasEdit = messages.some(
          (msg) =>
            msg.type === "assistant" &&
            msg.toolCalls.some((tc) => {
              const isEditTool = tc.name === "Edit" || tc.name === "Write";
              const matchesPath =
                tc.inputSummary.includes(filePath) ||
                tc.inputSummary.includes(fileName) ||
                (tc.fullInput != null && tc.fullInput.includes(filePath));
              return isEditTool && matchesPath;
            }),
        );

        if (hasEdit) {
          matching.push(toSessionSummary(session));
        }
      } catch {
        // Skip unreadable sessions
      }
    }

    return matching.sort((a, b) =>
      (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
    );
  }

  // --- Refresh ---

  async refresh(): Promise<void> {
    this.cache.scan();
    await this.cache.save();
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
