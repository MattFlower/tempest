// ============================================================
// Codex History Store
//
// Coordinates the Codex metadata cache and searcher. Mirrors the
// Claude/Pi history stores and implements the SessionHistoryProvider
// interface so the rest of the app can treat all three providers
// uniformly.
// ============================================================

import { homedir } from "node:os";
import { join } from "node:path";
import {
  CodexHistoryMetadataCache,
  extractSessionIdFromFilename,
  type CodexSessionSummaryData,
} from "./codex-metadata-cache";
import { CodexRipgrepSearcher } from "./codex-ripgrep-searcher";
import { parseFile } from "./codex-jsonl-parser";
import type { ParsedMessage, ToolCallInfo } from "./jsonl-parser";
import type {
  SessionSummary,
  SessionMessage,
  ToolCallInfo as IPCToolCall,
} from "../../shared/ipc-types";
import type { SessionHistoryProvider } from "./session-history-provider";

const CODEX_SESSIONS_ROOT = join(homedir(), ".codex", "sessions");

export class CodexHistoryStore implements SessionHistoryProvider {
  readonly providerId = "codex" as const;

  private readonly cache: CodexHistoryMetadataCache;
  private readonly searcher: CodexRipgrepSearcher;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  get isSearchAvailable(): boolean {
    return this.searcher.isAvailable;
  }

  constructor() {
    this.cache = new CodexHistoryMetadataCache();
    this.searcher = new CodexRipgrepSearcher();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.cache.load();
    this.cache.scan();
    await this.cache.save();
    this.initialized = true;
  }

  async getSessions(
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();
    return this.cache.sessions(scope, workspacePath).map(toSessionSummary);
  }

  async searchSessions(
    query: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    if (!this.searcher.isAvailable) {
      return this.cache
        .sessions(scope, workspacePath)
        .filter((s) =>
          s.firstPrompt.toLowerCase().includes(query.toLowerCase()),
        )
        .map(toSessionSummary);
    }

    const projectDirs =
      scope === "project" && workspacePath
        ? this.cache.projectDirsForWorkspace(workspacePath)
        : undefined;

    const filePaths = await this.searcher.search(query, scope, projectDirs);
    const summaries: SessionSummary[] = [];

    for (const path of filePaths) {
      const cached = this.cache.sessionByFilePath(path);
      if (cached) {
        summaries.push({
          filePath: cached.filePath,
          firstPrompt: cached.firstPrompt ?? "Untitled Session",
          createdAt: cached.createdAt,
          modifiedAt: cached.modifiedAt,
          gitBranch: undefined,
        });
      }
    }

    return summaries.sort((a, b) =>
      (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""),
    );
  }

  async getMessages(sessionFilePath: string): Promise<SessionMessage[]> {
    try {
      const parsed = await parseFile(sessionFilePath);
      return parsed.map(toSessionMessage);
    } catch {
      return [];
    }
  }

  ownsSessionFile(sessionFilePath: string): boolean {
    return sessionFilePath.startsWith(CODEX_SESSIONS_ROOT);
  }

  async sessionsWithToolCallsForFile(
    filePath: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]> {
    if (!this.initialized) await this.initialize();

    const fileName = filePath.split("/").pop() ?? filePath;
    const allSessions = this.cache.sessions(scope, workspacePath);
    const matching: SessionSummary[] = [];

    for (const session of allSessions) {
      try {
        const messages = await parseFile(session.filePath);
        const hasEdit = messages.some(
          (msg: ParsedMessage) =>
            msg.type === "assistant" &&
            msg.toolCalls.some((tc: ToolCallInfo) => {
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
        console.error("[CodexHistoryStore] refresh error:", err);
      }
    }, 30_000);
  }

  stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Resolve the Codex session UUID for a given rollout file path.
   * Used by the history UI's "Resume in new tab" action so it can pass
   * the UUID (not the path) to `codex resume <uuid>`.
   */
  async resolveCodexSessionId(filePath: string): Promise<string | undefined> {
    const cached = this.cache.sessionByFilePath(filePath);
    if (cached?.codexSessionId) return cached.codexSessionId;
    return extractSessionIdFromFilename(filePath);
  }
}

function toSessionSummary(data: CodexSessionSummaryData): SessionSummary {
  return {
    filePath: data.filePath,
    firstPrompt: data.firstPrompt,
    createdAt: data.createdAt,
    modifiedAt: data.modifiedAt,
    gitBranch: data.gitBranch,
  };
}

function toSessionMessage(msg: ParsedMessage): SessionMessage {
  return {
    type: msg.type as "user" | "assistant" | "system",
    text: msg.textContent ?? "",
    toolCalls: msg.toolCalls.map(
      (tc): IPCToolCall => ({
        tool: tc.name,
        summary: tc.inputSummary,
        input: tc.fullInput,
        inputParamCount: tc.inputParamCount,
      }),
    ),
    timestamp: msg.timestamp,
  };
}
