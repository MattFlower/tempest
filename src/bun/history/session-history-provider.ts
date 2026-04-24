// ============================================================
// SessionHistoryProvider — shared interface for chat history
// sources (Claude Code, Pi, …). Each provider scans its own
// on-disk session files and exposes them via this interface.
// ============================================================

import type { SessionSummary, SessionMessage } from "../../shared/ipc-types";

export type HistoryProviderId = "claude" | "pi" | "codex";

export interface SessionHistoryProvider {
  readonly providerId: HistoryProviderId;
  readonly isSearchAvailable: boolean;

  initialize(): Promise<void>;

  /** Lists sessions for the given scope. `workspacePath` is an absolute path. */
  getSessions(
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]>;

  searchSessions(
    query: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]>;

  getMessages(sessionFilePath: string): Promise<SessionMessage[]>;

  /** Returns whether this provider owns the given session file path. */
  ownsSessionFile(sessionFilePath: string): boolean;

  sessionsWithToolCallsForFile(
    filePath: string,
    scope: "all" | "project",
    workspacePath?: string,
  ): Promise<SessionSummary[]>;

  refresh(): Promise<void>;

  startRefreshTimer(): void;
  stopRefreshTimer(): void;
}
