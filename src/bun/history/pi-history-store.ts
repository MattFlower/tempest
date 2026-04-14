// ============================================================
// Pi History Store
//
// Coordinates the Pi metadata cache and searcher. Mirrors
// HistoryStore and implements the SessionHistoryProvider
// interface so the rest of the app can treat Claude and Pi
// session history uniformly.
// ============================================================

import { homedir } from "node:os";
import { join } from "node:path";
import {
  PiHistoryMetadataCache,
  type PiSessionSummaryData,
} from "./pi-metadata-cache";
import { PiRipgrepSearcher } from "./pi-ripgrep-searcher";
import { parseFile } from "./pi-jsonl-parser";
import type { ParsedMessage, ToolCallInfo } from "./jsonl-parser";
import type { SessionSummary, SessionMessage, ToolCallInfo as IPCToolCall } from "../../shared/ipc-types";
import type { SessionHistoryProvider } from "./session-history-provider";

const PI_SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

export class PiHistoryStore implements SessionHistoryProvider {
  readonly providerId = "pi" as const;

  private readonly cache: PiHistoryMetadataCache;
  private readonly searcher: PiRipgrepSearcher;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  get isSearchAvailable(): boolean {
    return this.searcher.isAvailable;
  }

  constructor() {
    this.cache = new PiHistoryMetadataCache();
    this.searcher = new PiRipgrepSearcher();
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
    return sessionFilePath.startsWith(PI_SESSIONS_ROOT);
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
        console.error("[PiHistoryStore] refresh error:", err);
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

function toSessionSummary(data: PiSessionSummaryData): SessionSummary {
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
