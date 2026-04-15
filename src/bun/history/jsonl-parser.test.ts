import { describe, it, expect, afterAll } from "bun:test";
import { parseLine, extractToolSummary, parseFile } from "./jsonl-parser";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

// ============================================================
// parseLine
// ============================================================

describe("parseLine", () => {
  // --- Skipped inputs ---

  describe("skipped inputs", () => {
    it("skips empty string", () => {
      expect(parseLine("")).toEqual({ kind: "skipped" });
    });

    it("skips whitespace-only string", () => {
      expect(parseLine("   \t  \n  ")).toEqual({ kind: "skipped" });
    });

    it("skips invalid JSON", () => {
      expect(parseLine("{not valid json}")).toEqual({ kind: "skipped" });
    });

    it("skips JSON string literal", () => {
      expect(parseLine('"hello"')).toEqual({ kind: "skipped" });
    });

    it("skips JSON number literal", () => {
      expect(parseLine("42")).toEqual({ kind: "skipped" });
    });

    it("skips JSON null literal", () => {
      expect(parseLine("null")).toEqual({ kind: "skipped" });
    });

    it("skips JSON array", () => {
      expect(parseLine("[1, 2, 3]")).toEqual({ kind: "skipped" });
    });

    it("skips object with missing type field", () => {
      expect(parseLine(JSON.stringify({ foo: "bar" }))).toEqual({
        kind: "skipped",
      });
    });

    it("skips object with non-string type field", () => {
      expect(parseLine(JSON.stringify({ type: 123 }))).toEqual({
        kind: "skipped",
      });
    });

    it("skips queue-operation noise type", () => {
      expect(parseLine(JSON.stringify({ type: "queue-operation" }))).toEqual({
        kind: "skipped",
      });
    });

    it("skips progress noise type", () => {
      expect(parseLine(JSON.stringify({ type: "progress" }))).toEqual({
        kind: "skipped",
      });
    });

    it("skips file-history-snapshot noise type", () => {
      expect(
        parseLine(JSON.stringify({ type: "file-history-snapshot" })),
      ).toEqual({ kind: "skipped" });
    });

    it("skips unknown type", () => {
      expect(
        parseLine(JSON.stringify({ type: "some-unknown-type" })),
      ).toEqual({ kind: "skipped" });
    });
  });

  // --- User messages ---

  describe("user messages", () => {
    it("extracts textContent from message.content string", () => {
      const line = JSON.stringify({
        type: "user",
        message: { content: "Hello, world!" },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.type).toBe("user");
        expect(result.message.textContent).toBe("Hello, world!");
        expect(result.message.toolCalls).toEqual([]);
      }
    });

    it("returns undefined textContent when message field is missing", () => {
      const line = JSON.stringify({ type: "user" });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.type).toBe("user");
        expect(result.message.textContent).toBeUndefined();
      }
    });

    it("returns undefined textContent when message is not an object", () => {
      const line = JSON.stringify({ type: "user", message: "not-an-object" });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
      }
    });

    it("returns undefined textContent when message.content is not a string", () => {
      const line = JSON.stringify({
        type: "user",
        message: { content: 42 },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
      }
    });

    it("builds searchableText from textContent", () => {
      const line = JSON.stringify({
        type: "user",
        message: { content: "search me" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.searchableText).toBe("search me");
      }
    });
  });

  // --- Assistant messages ---

  describe("assistant messages", () => {
    it("extracts text from text blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First paragraph." },
            { type: "text", text: "Second paragraph." },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.type).toBe("assistant");
        expect(result.message.textContent).toBe(
          "First paragraph.\nSecond paragraph.",
        );
        expect(result.message.toolCalls).toEqual([]);
      }
    });

    it("extracts tool calls from tool_use blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.toolCalls).toHaveLength(1);
        expect(result.message.toolCalls[0]!.name).toBe("Bash");
        expect(result.message.toolCalls[0]!.inputSummary).toBe("ls -la");
        expect(result.message.toolCalls[0]!.inputParamCount).toBe(1);
        expect(result.message.toolCalls[0]!.fullInput).toBe(
          JSON.stringify({ command: "ls -la" }, null, 2),
        );
      }
    });

    it("preserves nested tool input objects in fullInput", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: {
                file_path: "src/foo.ts",
                edits: [{ oldText: "before", newText: "after" }],
              },
            },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        const tc = result.message.toolCalls[0]!;
        expect(tc.fullInput).toBeDefined();
        const parsed = JSON.parse(tc.fullInput!);
        expect(parsed.file_path).toBe("src/foo.ts");
        expect(parsed.edits).toHaveLength(1);
        expect(parsed.edits[0].oldText).toBe("before");
        expect(parsed.edits[0].newText).toBe("after");
      }
    });

    it("extracts mixed text and tool_use blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check that file." },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/tmp/foo.txt" },
            },
            { type: "text", text: "Here is the content." },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBe(
          "Let me check that file.\nHere is the content.",
        );
        expect(result.message.toolCalls).toHaveLength(1);
        expect(result.message.toolCalls[0]!.name).toBe("Read");
        expect(result.message.toolCalls[0]!.inputSummary).toBe("/tmp/foo.txt");
      }
    });

    it("returns undefined textContent when message is missing", () => {
      const line = JSON.stringify({ type: "assistant" });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
        expect(result.message.toolCalls).toEqual([]);
      }
    });

    it("returns undefined textContent when content is not an array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: "a string" },
      });
      const result = parseLine(line);
      expect(result.kind === "message" && result.message.textContent).toBeFalsy();
    });

    it("handles empty content array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
        expect(result.message.toolCalls).toEqual([]);
      }
    });

    it("skips non-object content blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: ["not an object", 42, null, { type: "text", text: "ok" }],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBe("ok");
      }
    });

    it("skips text blocks with empty text", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "" }],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
      }
    });

    it("defaults tool_use name to Unknown when missing", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", input: { command: "echo hi" } },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.toolCalls[0]!.name).toBe("Unknown");
      }
    });

    it("handles tool_use with missing input", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash" }],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.toolCalls[0]!.name).toBe("Bash");
        expect(result.message.toolCalls[0]!.inputParamCount).toBe(0);
        // Fallback summary: "Bash " (name + empty sorted keys)
        expect(result.message.toolCalls[0]!.inputSummary).toBe("Bash ");
      }
    });

    it("builds searchableText from text and tool calls", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Checking the file." },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/etc/hosts" },
            },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.searchableText).toBe(
          "Checking the file. Read /etc/hosts",
        );
      }
    });
  });

  // --- System messages ---

  describe("system messages", () => {
    it("extracts textContent from content string", () => {
      const line = JSON.stringify({
        type: "system",
        content: "System prompt text",
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.type).toBe("system");
        expect(result.message.textContent).toBe("System prompt text");
        expect(result.message.toolCalls).toEqual([]);
      }
    });

    it("returns undefined textContent when content is not a string", () => {
      const line = JSON.stringify({
        type: "system",
        content: { nested: true },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBeUndefined();
      }
    });

    it("has undefined searchableText", () => {
      const line = JSON.stringify({
        type: "system",
        content: "System text",
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.searchableText).toBeUndefined();
      }
    });
  });

  // --- Metadata extraction ---

  describe("metadata extraction", () => {
    it("extracts uuid from top-level field", () => {
      const line = JSON.stringify({
        type: "user",
        uuid: "abc-123",
        message: { content: "hi" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.uuid).toBe("abc-123");
      }
    });

    it("extracts timestamp from top-level field", () => {
      const line = JSON.stringify({
        type: "user",
        timestamp: "2025-01-15T10:30:00Z",
        message: { content: "hi" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.timestamp).toBe("2025-01-15T10:30:00Z");
      }
    });

    it("extracts sessionId from top-level field", () => {
      const line = JSON.stringify({
        type: "user",
        sessionId: "sess-456",
        message: { content: "hi" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.sessionId).toBe("sess-456");
      }
    });

    it("extracts gitBranch from top-level field", () => {
      const line = JSON.stringify({
        type: "user",
        gitBranch: "feature/test",
        message: { content: "hi" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.gitBranch).toBe("feature/test");
      }
    });

    it("returns undefined for non-string metadata fields", () => {
      const line = JSON.stringify({
        type: "user",
        uuid: 123,
        timestamp: null,
        sessionId: true,
        gitBranch: { branch: "main" },
        message: { content: "hi" },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.uuid).toBeUndefined();
        expect(result.message.timestamp).toBeUndefined();
        expect(result.message.sessionId).toBeUndefined();
        expect(result.message.gitBranch).toBeUndefined();
      }
    });

    it("extracts all metadata fields together", () => {
      const line = JSON.stringify({
        type: "assistant",
        uuid: "msg-789",
        timestamp: "2025-06-01T12:00:00Z",
        sessionId: "sess-abc",
        gitBranch: "main",
        message: {
          content: [{ type: "text", text: "response" }],
        },
      });
      const result = parseLine(line);
      if (result.kind === "message") {
        expect(result.message.uuid).toBe("msg-789");
        expect(result.message.timestamp).toBe("2025-06-01T12:00:00Z");
        expect(result.message.sessionId).toBe("sess-abc");
        expect(result.message.gitBranch).toBe("main");
      }
    });
  });

  // --- Machine-generated messages (XML content) ---

  describe("machine-generated messages with XML content", () => {
    it("still parses user messages starting with XML tags", () => {
      const line = JSON.stringify({
        type: "user",
        message: { content: "<system-reminder>Some injected context</system-reminder>" },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.type).toBe("user");
        expect(result.message.textContent).toBe(
          "<system-reminder>Some injected context</system-reminder>",
        );
      }
    });

    it("still parses assistant messages starting with XML tags", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "<thinking>reasoning here</thinking>" },
          ],
        },
      });
      const result = parseLine(line);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        expect(result.message.textContent).toBe(
          "<thinking>reasoning here</thinking>",
        );
      }
    });
  });
});

// ============================================================
// extractToolSummary
// ============================================================

describe("extractToolSummary", () => {
  it("returns command for Bash tool", () => {
    expect(extractToolSummary("Bash", { command: "ls -la /tmp" })).toBe(
      "ls -la /tmp",
    );
  });

  it("returns file_path for Read tool", () => {
    expect(
      extractToolSummary("Read", { file_path: "/home/user/file.txt" }),
    ).toBe("/home/user/file.txt");
  });

  it("returns file_path for Edit tool", () => {
    expect(
      extractToolSummary("Edit", {
        file_path: "/src/index.ts",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe("/src/index.ts");
  });

  it("returns file_path for Write tool", () => {
    expect(
      extractToolSummary("Write", {
        file_path: "/tmp/output.txt",
        content: "data",
      }),
    ).toBe("/tmp/output.txt");
  });

  it("returns pattern for Grep tool", () => {
    expect(
      extractToolSummary("Grep", { pattern: "TODO.*fix", path: "/src" }),
    ).toBe("TODO.*fix");
  });

  it("returns pattern for Glob tool", () => {
    expect(
      extractToolSummary("Glob", { pattern: "**/*.ts", path: "/src" }),
    ).toBe("**/*.ts");
  });

  it("returns skill name for Skill tool", () => {
    expect(extractToolSummary("Skill", { skill: "commit" })).toBe("commit");
  });

  it("returns description for Agent tool", () => {
    expect(
      extractToolSummary("Agent", {
        description: "Find all usages of parseFile",
      }),
    ).toBe("Find all usages of parseFile");
  });

  it("returns subject for TaskCreate tool", () => {
    expect(
      extractToolSummary("TaskCreate", {
        subject: "Implement search feature",
        body: "details",
      }),
    ).toBe("Implement search feature");
  });

  it("returns taskId for TaskUpdate tool", () => {
    expect(
      extractToolSummary("TaskUpdate", {
        taskId: "task-42",
        status: "done",
      }),
    ).toBe("task-42");
  });

  it("returns fallback with tool name and sorted keys for unknown tool", () => {
    expect(
      extractToolSummary("MyCustomTool", { zeta: 1, alpha: 2, middle: 3 }),
    ).toBe("MyCustomTool alpha middle zeta");
  });

  it("returns fallback when known tool lacks its expected key", () => {
    // Bash without command key
    expect(
      extractToolSummary("Bash", { description: "run something" }),
    ).toBe("Bash description");
  });

  it("returns fallback with empty keys for empty input", () => {
    expect(extractToolSummary("SomeTool", {})).toBe("SomeTool ");
  });

  it("returns fallback when expected key is not a string", () => {
    expect(extractToolSummary("Bash", { command: 42 })).toBe("Bash command");
  });
});

// ============================================================
// parseFile
// ============================================================

describe("parseFile", () => {
  const tempFiles: string[] = [];
  let tempDir: string;

  // Create a shared temp directory
  const setupTempDir = async () => {
    if (!tempDir) {
      tempDir = await mkdtemp(join(tmpdir(), "jsonl-parser-test-"));
    }
    return tempDir;
  };

  afterAll(async () => {
    // Clean up all temp files
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function writeTempFile(
    name: string,
    content: string,
  ): Promise<string> {
    const dir = await setupTempDir();
    const filePath = join(dir, name);
    await Bun.write(filePath, content);
    tempFiles.push(filePath);
    return filePath;
  }

  it("parses multiple valid JSONL lines", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        message: { content: "Hello" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        message: {
          content: [{ type: "text", text: "Hi there!" }],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u2",
        message: { content: "Thanks" },
      }),
    ];
    const filePath = await writeTempFile(
      "valid.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.type).toBe("user");
    expect(messages[0]!.uuid).toBe("u1");
    expect(messages[0]!.textContent).toBe("Hello");
    expect(messages[1]!.type).toBe("assistant");
    expect(messages[1]!.uuid).toBe("a1");
    expect(messages[1]!.textContent).toBe("Hi there!");
    expect(messages[2]!.type).toBe("user");
    expect(messages[2]!.uuid).toBe("u2");
    expect(messages[2]!.textContent).toBe("Thanks");
  });

  it("skips empty lines and malformed JSON", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "valid line" },
      }),
      "",
      "   ",
      "{this is not json}",
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "also valid" }],
        },
      }),
    ];
    const filePath = await writeTempFile(
      "mixed.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.textContent).toBe("valid line");
    expect(messages[1]!.textContent).toBe("also valid");
  });

  it("skips noise types in file context", async () => {
    const lines = [
      JSON.stringify({ type: "queue-operation", data: {} }),
      JSON.stringify({ type: "progress", percent: 50 }),
      JSON.stringify({ type: "file-history-snapshot", files: [] }),
      JSON.stringify({
        type: "user",
        message: { content: "real message" },
      }),
    ];
    const filePath = await writeTempFile(
      "noise.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.textContent).toBe("real message");
  });

  it("returns empty array for file with only empty lines", async () => {
    const filePath = await writeTempFile(
      "empty.jsonl",
      "\n\n   \n\n",
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(0);
  });

  it("handles file with trailing newline", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "only message" },
      }),
      "",
    ];
    const filePath = await writeTempFile(
      "trailing.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.textContent).toBe("only message");
  });

  it("parses file with tool calls", async () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me run that." },
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "echo hello" },
            },
          ],
        },
      }),
    ];
    const filePath = await writeTempFile(
      "tools.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.textContent).toBe("Let me run that.");
    expect(messages[0]!.toolCalls).toHaveLength(1);
    expect(messages[0]!.toolCalls[0]!.name).toBe("Bash");
    expect(messages[0]!.toolCalls[0]!.inputSummary).toBe("echo hello");
  });

  it("handles file with all three message types", async () => {
    const lines = [
      JSON.stringify({ type: "system", content: "You are helpful." }),
      JSON.stringify({
        type: "user",
        message: { content: "What is 2+2?" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "4" }],
        },
      }),
    ];
    const filePath = await writeTempFile(
      "all-types.jsonl",
      lines.join("\n"),
    );
    const messages = await parseFile(filePath);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.type).toBe("system");
    expect(messages[0]!.textContent).toBe("You are helpful.");
    expect(messages[1]!.type).toBe("user");
    expect(messages[1]!.textContent).toBe("What is 2+2?");
    expect(messages[2]!.type).toBe("assistant");
    expect(messages[2]!.textContent).toBe("4");
  });
});
