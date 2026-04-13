// ============================================================
// Unit tests for the AI Context Provider.
// Tests the helper functions that extract file changes, change
// details, and conversation context from session messages.
// ============================================================

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { AIContextProvider } from "./ai-context-provider";
import type { SessionMessage, ToolCallInfo } from "../../shared/ipc-types";

// --- Helper to build SessionMessage ---

function makeMessage(
  type: "user" | "assistant" | "system",
  text: string,
  toolCalls?: Array<{ tool: string; summary: string; input?: string }>,
  timestamp?: string,
): SessionMessage {
  return {
    type,
    text,
    toolCalls: toolCalls?.map((tc) => ({
      tool: tc.tool,
      summary: tc.summary,
      input: tc.input,
      inputParamCount: tc.input ? Object.keys(JSON.parse(tc.input)).length : 0,
    })),
    timestamp,
  };
}

// --- Test the provider with a mock store ---

function createMockStore(
  sessions: Array<{ filePath: string; firstPrompt: string }>,
  messages: SessionMessage[],
) {
  return {
    sessionsWithToolCallsForFile: mock(async () =>
      sessions.map((s) => ({
        filePath: s.filePath,
        firstPrompt: s.firstPrompt,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-01-01T01:00:00Z",
      })),
    ),
    getMessages: mock(async () => messages),
    // Stubs for other HistoryStore methods
    initialize: mock(async () => {}),
    getSessions: mock(async () => []),
    searchSessions: mock(async () => []),
    refresh: mock(async () => {}),
    startRefreshTimer: mock(() => {}),
    stopRefreshTimer: mock(() => {}),
  } as any;
}

describe("AIContextProvider", () => {
  describe("contextForFile", () => {
    test("returns null when no matching sessions", async () => {
      const store = createMockStore([], []);
      const provider = new AIContextProvider(store);
      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).toBeNull();
    });

    test("returns context with file changes for matching Edit tool calls", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Edit this file"),
        makeMessage("assistant", "Done.", [
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "old code",
              new_string: "new code",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/1.jsonl", firstPrompt: "Edit this file" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).not.toBeNull();
      expect(result!.totalChanges).toBe(1);
      expect(result!.sessions).toHaveLength(1);
      expect(result!.sessions[0]!.fileChanges).toHaveLength(1);
      expect(result!.sessions[0]!.fileChanges[0]!.toolName).toBe("Edit");
    });

    test("returns context with file changes for Write tool calls", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Create this file"),
        makeMessage("assistant", "Created.", [
          {
            tool: "Write",
            summary: "file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              content: "full file content",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/2.jsonl", firstPrompt: "Create this file" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).not.toBeNull();
      expect(result!.totalChanges).toBe(1);
      expect(result!.sessions[0]!.fileChanges[0]!.toolName).toBe("Write");
    });

    test("ignores non-Edit/Write tool calls", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Read this file"),
        makeMessage("assistant", "Here's the content.", [
          { tool: "Read", summary: "/path/to/file.ts" },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/3.jsonl", firstPrompt: "Read this file" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const result = await provider.contextForFile("/path/to/file.ts");
      // Should be null since Read is not Edit/Write
      expect(result).toBeNull();
    });

    test("matches by filename when full path not in summary", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Fix the bug"),
        makeMessage("assistant", "Fixed.", [
          {
            tool: "Edit",
            summary: "file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "bug",
              new_string: "fix",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/4.jsonl", firstPrompt: "Fix the bug" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).not.toBeNull();
      expect(result!.totalChanges).toBe(1);
    });
  });

  describe("timelineForFile", () => {
    test("returns null when no context available", async () => {
      const store = createMockStore([], []);
      const provider = new AIContextProvider(store);
      const result = await provider.timelineForFile("/path/to/file.ts");
      expect(result).toBeNull();
    });

    test("builds timeline with edit details", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Make changes"),
        makeMessage(
          "assistant",
          "Editing file.",
          [
            {
              tool: "Edit",
              summary: "/path/to/file.ts",
              input: JSON.stringify({
                file_path: "/path/to/file.ts",
                old_string: "before",
                new_string: "after",
              }),
            },
          ],
          "2026-01-01T12:00:00Z",
        ),
      ];

      const store = createMockStore(
        [{ filePath: "/session/5.jsonl", firstPrompt: "Make changes" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      expect(timeline!.changes).toHaveLength(1);

      const change = timeline!.changes[0]!;
      expect(change.index).toBe(0);
      expect(change.toolName).toBe("Edit");
      expect(change.detail.type).toBe("edit");
      if (change.detail.type === "edit") {
        expect(change.detail.oldString).toBe("before");
        expect(change.detail.newString).toBe("after");
      }
    });

    test("builds timeline with write details", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Create file"),
        makeMessage("assistant", "Writing file.", [
          {
            tool: "Write",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              content: "full content here",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/6.jsonl", firstPrompt: "Create file" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      const change = timeline!.changes[0]!;
      expect(change.detail.type).toBe("write");
      if (change.detail.type === "write") {
        expect(change.detail.fullContent).toBe("full content here");
      }
    });

    test("builds conversation context around changes", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "First message from user"),
        makeMessage("user", "Please edit the file"),
        makeMessage("assistant", "Editing now.", [
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "old",
              new_string: "new",
            }),
          },
        ]),
        makeMessage("assistant", "Done editing."),
      ];

      const store = createMockStore(
        [{ filePath: "/session/7.jsonl", firstPrompt: "First message" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      const context = timeline!.changes[0]!.conversationContext;
      // Should include messages around index 2 (the Edit message): indices 0-3
      expect(context).toContain("You:");
      expect(context).toContain("Claude:");
    });

    test("assigns sequential global indices across sessions", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Edit two things"),
        makeMessage("assistant", "First edit.", [
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "a",
              new_string: "b",
            }),
          },
        ]),
        makeMessage("assistant", "Second edit.", [
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "c",
              new_string: "d",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/8.jsonl", firstPrompt: "Edit two things" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      expect(timeline!.changes).toHaveLength(2);
      expect(timeline!.changes[0]!.index).toBe(0);
      expect(timeline!.changes[1]!.index).toBe(1);
    });
  });
});
