// ============================================================
// AI Context Provider — Port of AIContextProvider.swift
// Searches JSONL history for Claude sessions that edited a
// specific file. Builds context and timeline structures.
// ============================================================

import type {
  FileAIContext,
  AISessionContext,
  FileChangeEvent,
  FileChangeTimeline,
  FileVersionChange,
  ToolChangeDetail,
  SessionMessage,
} from "../../shared/ipc-types";
import type { HistoryStore } from "../history/history-store";
import { parseFile, type ParsedMessage } from "../history/jsonl-parser";
import { basename } from "node:path";

export class AIContextProvider {
  constructor(private readonly store: HistoryStore) {}

  async contextForFile(
    filePath: string,
    projectPath?: string,
  ): Promise<FileAIContext | null> {
    const scope = projectPath ? "project" : "all";
    const matchingSessions = await this.store.sessionsWithToolCallsForFile(
      filePath,
      scope,
      projectPath,
    );

    if (matchingSessions.length === 0) return null;

    const sessionContexts: AISessionContext[] = [];
    let totalChanges = 0;

    for (const summary of matchingSessions) {
      const messages = await this.store.getMessages(summary.filePath);
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

    const changes: FileVersionChange[] = [];
    let globalIndex = 0;

    for (const session of context.sessions) {
      for (const event of session.fileChanges) {
        const detail = extractChangeDetail(
          session.messages,
          event.messageIndex,
          filePath,
        );
        const conversationContext = extractConversationContext(
          session.messages,
          event.messageIndex,
        );

        changes.push({
          id: crypto.randomUUID(),
          index: globalIndex,
          timestamp: event.timestamp,
          sessionId: session.id,
          toolName: event.toolName,
          detail,
          conversationContext,
        });
        globalIndex += 1;
      }
    }

    if (changes.length === 0) return null;

    return { filePath, changes };
  }
}

// --- Private helpers ---

function extractFileChanges(
  messages: SessionMessage[],
  filePath: string,
): FileChangeEvent[] {
  const fileName = basename(filePath);
  const events: FileChangeEvent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.type !== "assistant" || !msg.toolCalls) continue;

    for (const tc of msg.toolCalls) {
      const isFileRelated = tc.tool === "Edit" || tc.tool === "Write";
      const matchesPath =
        tc.summary.includes(filePath) ||
        tc.summary.includes(fileName) ||
        (tc.input != null && tc.input.includes(filePath));

      if (isFileRelated && matchesPath) {
        events.push({
          id: crypto.randomUUID(),
          messageIndex: i,
          toolName: tc.tool,
          inputSummary: tc.summary,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return events;
}

function extractChangeDetail(
  messages: SessionMessage[],
  messageIndex: number,
  filePath: string,
): ToolChangeDetail {
  const msg = messages[messageIndex];
  if (!msg) return { type: "unknown", summary: "No message found" };

  const fileName = basename(filePath);

  for (const tc of msg.toolCalls ?? []) {
    const matchesPath =
      tc.summary.includes(filePath) ||
      tc.summary.includes(fileName) ||
      (tc.input != null && tc.input.includes(filePath));
    if (!matchesPath) continue;

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

  return { type: "unknown", summary: "No matching tool call found" };
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
    const prefix = msg.type === "user" ? "You" : "Claude";
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
    parts.push(`${prefix}: ${truncated}`);
  }
  return parts.join("\n");
}
