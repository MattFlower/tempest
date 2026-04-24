// ============================================================
// AI Context Provider — Port of AIContextProvider.swift
// Fans out across every registered history provider (Claude, Pi,
// Codex, ...) via HistoryAggregator and builds per-file context +
// timeline structures from their combined edits.
// ============================================================

import type {
  FileAIContext,
  AISessionContext,
  FileChangeEvent,
  FileChangeTimeline,
  FileVersionChange,
  ToolChangeDetail,
  SessionMessage,
  ToolCallInfo,
} from "../../shared/ipc-types";
import type { HistoryAggregator } from "../history/history-aggregator";
import { basename } from "node:path";

export class AIContextProvider {
  constructor(private readonly aggregator: HistoryAggregator) {}

  async contextForFile(
    filePath: string,
    projectPath?: string,
  ): Promise<FileAIContext | null> {
    const scope = projectPath ? "project" : "all";

    // Fan out: collect matching sessions from every provider, then dedupe
    // by filePath (a file system path is owned by exactly one provider,
    // so collisions shouldn't happen — but this keeps the invariant if a
    // provider ever reports over-broadly).
    const seen = new Set<string>();
    const allMatching: Array<{ filePath: string; firstPrompt: string }> = [];
    for (const provider of this.aggregator.allProviders()) {
      const matches = await provider.sessionsWithToolCallsForFile(
        filePath,
        scope,
        projectPath,
      );
      for (const m of matches) {
        if (seen.has(m.filePath)) continue;
        seen.add(m.filePath);
        allMatching.push({ filePath: m.filePath, firstPrompt: m.firstPrompt });
      }
    }

    if (allMatching.length === 0) return null;

    const sessionContexts: AISessionContext[] = [];
    let totalChanges = 0;

    for (const summary of allMatching) {
      // getMessages routes through the aggregator, which dispatches by
      // ownsSessionFile so each session file is parsed by the right
      // provider (Claude / Pi / Codex).
      const messages = await this.aggregator.getMessages(summary.filePath);
      const fileChanges = extractFileChanges(messages, filePath);
      totalChanges += fileChanges.length;

      if (fileChanges.length > 0) {
        sessionContexts.push({
          id: summary.filePath,
          sessionSummary: summary.firstPrompt,
          messages,
          fileChanges,
        });
      }
    }

    if (sessionContexts.length === 0) return null;

    return { filePath, sessions: sessionContexts, totalChanges };
  }

  async timelineForFile(
    filePath: string,
    projectPath?: string,
  ): Promise<FileChangeTimeline | null> {
    const context = await this.contextForFile(filePath, projectPath);
    if (!context) return null;

    const pendingChanges: Array<FileVersionChange & { _sequence: number }> = [];
    let sequence = 0;

    for (const session of context.sessions) {
      for (const event of session.fileChanges) {
        const detail = extractChangeDetail(session.messages, event, filePath);
        const conversationContext = extractConversationContext(
          session.messages,
          event.messageIndex,
        );

        pendingChanges.push({
          id: crypto.randomUUID(),
          eventId: event.id,
          index: 0,
          timestamp: event.timestamp,
          sessionId: session.id,
          toolName: event.toolName,
          detail,
          conversationContext,
          _sequence: sequence,
        });
        sequence += 1;
      }
    }

    if (pendingChanges.length === 0) return null;

    pendingChanges.sort(compareTimelineChanges);

    const changes: FileVersionChange[] = pendingChanges.map((change, index) => ({
      id: change.id,
      eventId: change.eventId,
      index,
      timestamp: change.timestamp,
      sessionId: change.sessionId,
      toolName: change.toolName,
      detail: change.detail,
      conversationContext: change.conversationContext,
    }));

    return { filePath, changes };
  }
}

// --- Private helpers ---

function extractFileChanges(
  messages: SessionMessage[],
  filePath: string,
): FileChangeEvent[] {
  const events: FileChangeEvent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.type !== "assistant" || !msg.toolCalls) continue;

    for (let toolCallIndex = 0; toolCallIndex < msg.toolCalls.length; toolCallIndex++) {
      const tc = msg.toolCalls[toolCallIndex]!;
      if (!isEditTool(tc.tool)) continue;
      if (!toolCallMatchesFile(tc, filePath)) continue;

      events.push({
        id: crypto.randomUUID(),
        messageIndex: i,
        toolCallIndex,
        toolName: tc.tool,
        inputSummary: tc.summary,
        timestamp: msg.timestamp,
      });
    }
  }

  return events;
}

function extractChangeDetail(
  messages: SessionMessage[],
  event: FileChangeEvent,
  filePath: string,
): ToolChangeDetail {
  const msg = messages[event.messageIndex];
  if (!msg) return { type: "unknown", summary: "No message found" };

  const toolCalls = msg.toolCalls ?? [];
  const direct = toolCalls[event.toolCallIndex];

  if (
    direct &&
    direct.tool === event.toolName &&
    toolCallMatchesFile(direct, filePath)
  ) {
    return toChangeDetail(direct);
  }

  const fallback = toolCalls.find(
    (tc) => tc.tool === event.toolName && toolCallMatchesFile(tc, filePath),
  );
  if (!fallback) {
    return { type: "unknown", summary: "No matching tool call found" };
  }

  return toChangeDetail(fallback);
}

function toChangeDetail(tc: ToolCallInfo): ToolChangeDetail {
  if (tc.tool === "Edit" && tc.input) {
    try {
      const json = JSON.parse(tc.input);
      return {
        type: "edit",
        oldString: json.old_string ?? "",
        newString: json.new_string ?? "",
      };
    } catch {
      // fall through
    }
  }

  if (tc.tool === "Write" && tc.input) {
    try {
      const json = JSON.parse(tc.input);
      return { type: "write", fullContent: json.content ?? "" };
    } catch {
      // fall through
    }
  }

  return { type: "unknown", summary: tc.summary };
}

function extractConversationContext(
  messages: SessionMessage[],
  messageIndex: number,
): string {
  const start = Math.max(0, messageIndex - 2);
  const end = Math.min(messages.length - 1, messageIndex + 1);

  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const msg = messages[i]!;
    const text = msg.text;
    if (!text) continue;
    const prefix = msg.type === "user" ? "You" : "Assistant";
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
    parts.push(`${prefix}: ${truncated}`);
  }
  return parts.join("\n");
}

function isEditTool(toolName: string): boolean {
  return toolName === "Edit" || toolName === "Write";
}

function toolCallMatchesFile(tc: ToolCallInfo, filePath: string): boolean {
  const fileName = basename(filePath);

  const inputPath = extractPathFromToolInput(tc.input);
  if (inputPath && pathMatchesFile(inputPath, filePath, fileName)) {
    return true;
  }

  return summaryMatchesFile(tc.summary, filePath, fileName);
}

function extractPathFromToolInput(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== "object" || parsed == null) return null;

    const maybePath =
      typeof parsed.file_path === "string"
        ? parsed.file_path
        : typeof parsed.path === "string"
          ? parsed.path
          : null;

    return maybePath;
  } catch {
    return null;
  }
}

function summaryMatchesFile(
  summary: string,
  filePath: string,
  fileName: string,
): boolean {
  const normalized = summary.trim();
  if (!normalized) return false;

  if (pathMatchesFile(normalized, filePath, fileName)) {
    return true;
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/^["'`([{<]+|[)\]}>"'`.,:;!?]+$/g, ""))
    .filter((token) => token.length > 0);

  return tokens.some((token) => pathMatchesFile(token, filePath, fileName));
}

function pathMatchesFile(
  candidatePath: string,
  filePath: string,
  fileName: string,
): boolean {
  if (candidatePath === filePath) return true;
  return basename(candidatePath) === fileName;
}

function compareTimelineChanges(
  a: FileVersionChange & { _sequence: number },
  b: FileVersionChange & { _sequence: number },
): number {
  const aTime = parseTimestamp(a.timestamp);
  const bTime = parseTimestamp(b.timestamp);

  if (aTime != null && bTime != null && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aTime != null && bTime == null) return -1;
  if (aTime == null && bTime != null) return 1;

  return a._sequence - b._sequence;
}

function parseTimestamp(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? null : time;
}
