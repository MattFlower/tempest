// ============================================================
// Unit tests for the AI Context Provider.
// Tests the helper functions that extract file changes, change
// details, and conversation context from session messages.
// ============================================================

import { describe, test, expect, mock } from "bun:test";
import { AIContextProvider } from "./ai-context-provider";
import type { SessionMessage } from "../../shared/ipc-types";

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
  messagesOrBySession: SessionMessage[] | Record<string, SessionMessage[]>,
) {
  const messagesBySession = Array.isArray(messagesOrBySession)
    ? null
    : messagesOrBySession;
  const sharedMessages = Array.isArray(messagesOrBySession)
    ? messagesOrBySession
    : [];

  // AIContextProvider now consumes a HistoryAggregator: it calls
  // `allProviders()` and iterates, then `getMessages(filePath)` routes
  // to the owning provider. The mock exposes both methods on the
  // aggregator and wraps a single fake provider.
  const fakeProvider = {
    providerId: "claude" as const,
    isSearchAvailable: false,
    initialize: mock(async () => {}),
    getSessions: mock(async () => []),
    searchSessions: mock(async () => []),
    getMessages: mock(async (sessionFilePath: string) =>
      messagesBySession?.[sessionFilePath] ?? sharedMessages,
    ),
    ownsSessionFile: (path: string) => sessions.some((s) => s.filePath === path),
    sessionsWithToolCallsForFile: mock(async () =>
      sessions.map((s) => ({
        filePath: s.filePath,
        firstPrompt: s.firstPrompt,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-01-01T01:00:00Z",
      })),
    ),
    refresh: mock(async () => {}),
    startRefreshTimer: mock(() => {}),
    stopRefreshTimer: mock(() => {}),
  };

  return {
    allProviders: () => [fakeProvider],
    provider: () => fakeProvider,
    getMessages: mock(async (sessionFilePath: string) =>
      messagesBySession?.[sessionFilePath] ?? sharedMessages,
    ),
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

    test("does not match substring filename collisions", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Edit a similarly named file"),
        makeMessage("assistant", "Done.", [
          {
            tool: "Edit",
            summary: "/path/to/file.tsx",
            input: JSON.stringify({
              file_path: "/path/to/file.tsx",
              old_string: "const x = 1",
              new_string: "const x = 2",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/4b.jsonl", firstPrompt: "Edit a similarly named file" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).toBeNull();
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

    test("uses the correct detail when multiple edits target the same file in one message", async () => {
      const messages: SessionMessage[] = [
        makeMessage("user", "Apply two edits"),
        makeMessage("assistant", "Applied edits.", [
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "first-before",
              new_string: "first-after",
            }),
          },
          {
            tool: "Edit",
            summary: "/path/to/file.ts",
            input: JSON.stringify({
              file_path: "/path/to/file.ts",
              old_string: "second-before",
              new_string: "second-after",
            }),
          },
        ]),
      ];

      const store = createMockStore(
        [{ filePath: "/session/5b.jsonl", firstPrompt: "Apply two edits" }],
        messages,
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      expect(timeline!.changes).toHaveLength(2);

      const details = timeline!.changes.map((c) => c.detail);
      expect(details[0]!.type).toBe("edit");
      expect(details[1]!.type).toBe("edit");

      if (details[0]!.type === "edit" && details[1]!.type === "edit") {
        expect(details[0]!.oldString).toBe("first-before");
        expect(details[0]!.newString).toBe("first-after");
        expect(details[1]!.oldString).toBe("second-before");
        expect(details[1]!.newString).toBe("second-after");
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
      expect(context).toContain("Assistant:");
    });

    test("sorts timeline changes chronologically across sessions", async () => {
      const oldSessionPath = "/session/older.jsonl";
      const newSessionPath = "/session/newer.jsonl";

      const store = createMockStore(
        [
          // Intentionally newest-first to mirror metadata-cache ordering.
          { filePath: newSessionPath, firstPrompt: "newer session" },
          { filePath: oldSessionPath, firstPrompt: "older session" },
        ],
        {
          [newSessionPath]: [
            makeMessage("user", "newer"),
            makeMessage(
              "assistant",
              "new change",
              [
                {
                  tool: "Edit",
                  summary: "/path/to/file.ts",
                  input: JSON.stringify({
                    file_path: "/path/to/file.ts",
                    old_string: "v1",
                    new_string: "v2",
                  }),
                },
              ],
              "2026-01-02T10:00:00Z",
            ),
          ],
          [oldSessionPath]: [
            makeMessage("user", "older"),
            makeMessage(
              "assistant",
              "old change",
              [
                {
                  tool: "Edit",
                  summary: "/path/to/file.ts",
                  input: JSON.stringify({
                    file_path: "/path/to/file.ts",
                    old_string: "v0",
                    new_string: "v1",
                  }),
                },
              ],
              "2026-01-01T10:00:00Z",
            ),
          ],
        },
      );
      const provider = new AIContextProvider(store);

      const timeline = await provider.timelineForFile("/path/to/file.ts");
      expect(timeline).not.toBeNull();
      expect(timeline!.changes).toHaveLength(2);
      expect(timeline!.changes[0]!.sessionId).toBe(oldSessionPath);
      expect(timeline!.changes[1]!.sessionId).toBe(newSessionPath);
      expect(timeline!.changes[0]!.index).toBe(0);
      expect(timeline!.changes[1]!.index).toBe(1);
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

  describe("multi-provider fan-out", () => {
    test("collects and dedupes sessions across Claude and Codex providers and routes getMessages to the owning provider", async () => {
      const claudePath = "/home/u/.claude/sessions/abc.jsonl";
      const codexPath = "/home/u/.codex/sessions/2026/03/01/rollout-xyz.jsonl";
      const duplicatePath = codexPath; // same file reported by both providers

      const claudeEdit = makeMessage("assistant", "via claude", [
        {
          tool: "Edit",
          summary: "/path/to/file.ts",
          input: JSON.stringify({
            file_path: "/path/to/file.ts",
            old_string: "claude-old",
            new_string: "claude-new",
          }),
        },
      ]);

      const codexEdit = makeMessage("assistant", "via codex", [
        {
          tool: "Edit",
          summary: "/path/to/file.ts",
          input: JSON.stringify({
            file_path: "/path/to/file.ts",
            old_string: "codex-old",
            new_string: "codex-new",
          }),
        },
      ]);

      const claudeGetMessages = mock(async (_p: string) => [claudeEdit]);
      const codexGetMessages = mock(async (_p: string) => [codexEdit]);

      const claudeProvider = {
        providerId: "claude" as const,
        isSearchAvailable: false,
        initialize: mock(async () => {}),
        getSessions: mock(async () => []),
        searchSessions: mock(async () => []),
        getMessages: claudeGetMessages,
        ownsSessionFile: (p: string) => p === claudePath,
        sessionsWithToolCallsForFile: mock(async () => [
          {
            filePath: claudePath,
            firstPrompt: "claude session",
            createdAt: "2026-01-01T00:00:00Z",
            modifiedAt: "2026-01-01T01:00:00Z",
          },
          {
            filePath: duplicatePath,
            firstPrompt: "dupe reported by claude",
            createdAt: "2026-01-01T00:00:00Z",
            modifiedAt: "2026-01-01T01:00:00Z",
          },
        ]),
        refresh: mock(async () => {}),
        startRefreshTimer: mock(() => {}),
        stopRefreshTimer: mock(() => {}),
      };

      const codexProvider = {
        providerId: "codex" as const,
        isSearchAvailable: false,
        initialize: mock(async () => {}),
        getSessions: mock(async () => []),
        searchSessions: mock(async () => []),
        getMessages: codexGetMessages,
        ownsSessionFile: (p: string) => p === codexPath,
        sessionsWithToolCallsForFile: mock(async () => [
          {
            filePath: codexPath,
            firstPrompt: "codex session",
            createdAt: "2026-01-02T00:00:00Z",
            modifiedAt: "2026-01-02T01:00:00Z",
          },
        ]),
        refresh: mock(async () => {}),
        startRefreshTimer: mock(() => {}),
        stopRefreshTimer: mock(() => {}),
      };

      const aggregator: any = {
        allProviders: () => [claudeProvider, codexProvider],
        getMessages: async (filePath: string) => {
          if (claudeProvider.ownsSessionFile(filePath))
            return claudeProvider.getMessages(filePath);
          if (codexProvider.ownsSessionFile(filePath))
            return codexProvider.getMessages(filePath);
          return [];
        },
      };

      const provider = new AIContextProvider(aggregator);
      const result = await provider.contextForFile("/path/to/file.ts");
      expect(result).not.toBeNull();

      // Two unique session file paths: claudePath and codexPath. The
      // duplicate codexPath reported by Claude must be deduped.
      expect(result!.sessions).toHaveLength(2);
      const sessionIds = new Set(result!.sessions.map((s) => s.id));
      expect(sessionIds.has(claudePath)).toBe(true);
      expect(sessionIds.has(codexPath)).toBe(true);

      // Each session's messages must be fetched from its owning provider,
      // not whichever provider reported it first.
      const claudeSession = result!.sessions.find((s) => s.id === claudePath)!;
      const codexSession = result!.sessions.find((s) => s.id === codexPath)!;
      expect(claudeSession.messages).toEqual([claudeEdit]);
      expect(codexSession.messages).toEqual([codexEdit]);
      expect(claudeGetMessages).toHaveBeenCalledTimes(1);
      expect(codexGetMessages).toHaveBeenCalledTimes(1);
    });
  });
});
