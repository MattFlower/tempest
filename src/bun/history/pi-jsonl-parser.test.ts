import { describe, it, expect, afterAll } from "bun:test";
import {
  parseLine,
  parseFile,
  parseSessionHeader,
  extractToolSummary,
  normalizeToolName,
} from "./pi-jsonl-parser";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDirs: string[] = [];

afterAll(async () => {
  for (const dir of tmpDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-jsonl-parser-test-"));
  tmpDirs.push(dir);
  return dir;
}

// --- parseLine ---

describe("parseLine", () => {
  it("skips empty / whitespace / invalid lines", () => {
    expect(parseLine("").kind).toBe("skipped");
    expect(parseLine("   \n  ").kind).toBe("skipped");
    expect(parseLine("{not json").kind).toBe("skipped");
    expect(parseLine('"just a string"').kind).toBe("skipped");
  });

  it("skips envelope records that aren't messages or headers", () => {
    const line = JSON.stringify({
      type: "model_change",
      id: "m1",
      provider: "openai-codex",
      modelId: "gpt-5",
    });
    expect(parseLine(line).kind).toBe("skipped");

    const label = JSON.stringify({ type: "label", id: "l1" });
    expect(parseLine(label).kind).toBe("skipped");
  });

  it("returns header for type:session records", () => {
    const line = JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-123",
      timestamp: "2026-04-14T00:00:00Z",
      cwd: "/Users/me/project",
    });
    const result = parseLine(line);
    expect(result.kind).toBe("header");
    if (result.kind !== "header") return;
    expect(result.cwd).toBe("/Users/me/project");
    expect(result.id).toBe("sess-123");
    expect(result.timestamp).toBe("2026-04-14T00:00:00Z");
  });

  it("parses a user text message", () => {
    const line = JSON.stringify({
      type: "message",
      id: "u1",
      timestamp: "2026-04-14T00:01:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.type).toBe("user");
    expect(result.message.textContent).toBe("Hello world");
    expect(result.message.toolCalls).toHaveLength(0);
    expect(result.message.timestamp).toBe("2026-04-14T00:01:00Z");
  });

  it("parses a user message with plain string content", () => {
    const line = JSON.stringify({
      type: "message",
      id: "u2",
      message: { role: "user", content: "Plain string prompt" },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.textContent).toBe("Plain string prompt");
  });

  it("parses an assistant message and drops thinking blocks", () => {
    const line = JSON.stringify({
      type: "message",
      id: "a1",
      timestamp: "2026-04-14T00:02:00Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "encrypted", thinkingSignature: "x" },
          { type: "text", text: "Hi there" },
        ],
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.type).toBe("assistant");
    expect(result.message.textContent).toBe("Hi there");
    expect(result.message.toolCalls).toHaveLength(0);
  });

  it("preserves nested objects in fullInput (e.g. Pi edit operations)", () => {
    // Regression: a previous version passed an array as the JSON.stringify
    // replacer, which acts as a recursive property allowlist and stripped
    // nested keys like `oldText` / `newText` from edits, rendering as `[ {} ]`.
    const line = JSON.stringify({
      type: "message",
      id: "a3",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_2",
            name: "edit",
            arguments: {
              path: "src/foo.ts",
              edits: [{ oldText: "before", newText: "after" }],
            },
          },
        ],
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    const tc = result.message.toolCalls[0]!;
    expect(tc.fullInput).toBeDefined();
    const parsed = JSON.parse(tc.fullInput!);
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0].oldText).toBe("before");
    expect(parsed.edits[0].newText).toBe("after");
    expect(parsed.path).toBe("src/foo.ts");
  });

  it("parses an assistant tool call with normalized name and summary", () => {
    const line = JSON.stringify({
      type: "message",
      id: "a2",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "bash",
            arguments: { command: "ls -la", timeout: 10 },
          },
        ],
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.toolCalls).toHaveLength(1);
    expect(result.message.toolCalls[0]!.name).toBe("Bash");
    expect(result.message.toolCalls[0]!.inputSummary).toBe("ls -la");
    expect(result.message.toolCalls[0]!.inputParamCount).toBe(2);
  });

  it("skips toolResult messages", () => {
    const line = JSON.stringify({
      type: "message",
      id: "t1",
      message: {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
      },
    });
    expect(parseLine(line).kind).toBe("skipped");
  });
});

// --- parseSessionHeader ---

describe("parseSessionHeader", () => {
  it("returns cwd/timestamp/id from a session header", () => {
    const line = JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-1",
      timestamp: "2026-04-14T00:00:00Z",
      cwd: "/Users/me/repo",
    });
    const header = parseSessionHeader(line);
    expect(header).toBeDefined();
    expect(header!.cwd).toBe("/Users/me/repo");
  });

  it("returns undefined for non-header lines", () => {
    const line = JSON.stringify({
      type: "message",
      id: "m",
      message: { role: "user", content: "hi" },
    });
    expect(parseSessionHeader(line)).toBeUndefined();
  });
});

// --- extractToolSummary / normalizeToolName ---

describe("extractToolSummary", () => {
  it("uses command for bash", () => {
    expect(extractToolSummary("bash", { command: "pwd" })).toBe("pwd");
  });

  it("uses path for read/edit/write", () => {
    expect(extractToolSummary("read", { path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(extractToolSummary("edit", { path: "/a/b.ts", edits: [] })).toBe(
      "/a/b.ts",
    );
    expect(
      extractToolSummary("write", { path: "/a/b.ts", content: "x" }),
    ).toBe("/a/b.ts");
  });

  it("falls back to name + sorted keys for unknown tools", () => {
    expect(extractToolSummary("mystery", { y: 1, x: 2 })).toBe("mystery x y");
  });
});

describe("normalizeToolName", () => {
  it("maps lowercase Pi names to Title Case", () => {
    expect(normalizeToolName("bash")).toBe("Bash");
    expect(normalizeToolName("read")).toBe("Read");
    expect(normalizeToolName("edit")).toBe("Edit");
    expect(normalizeToolName("write")).toBe("Write");
  });

  it("capitalizes unknown tool names", () => {
    expect(normalizeToolName("search")).toBe("Search");
    expect(normalizeToolName("")).toBe("");
  });
});

// --- parseFile ---

describe("parseFile", () => {
  it("parses a multi-line Pi session file", async () => {
    const dir = await makeTmpDir();
    const file = join(dir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        id: "s1",
        timestamp: "2026-04-14T00:00:00Z",
        cwd: "/tmp",
      }),
      JSON.stringify({
        type: "model_change",
        id: "mc",
        provider: "openai-codex",
        modelId: "gpt-5",
      }),
      JSON.stringify({
        type: "message",
        id: "u1",
        timestamp: "2026-04-14T00:00:01Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Run ls" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        timestamp: "2026-04-14T00:00:02Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_1",
              name: "bash",
              arguments: { command: "ls" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "tr",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          content: [{ type: "text", text: "a.txt" }],
        },
      }),
    ];
    await writeFile(file, lines.join("\n") + "\n");

    const parsed = await parseFile(file);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.type).toBe("user");
    expect(parsed[0]!.textContent).toBe("Run ls");
    expect(parsed[1]!.type).toBe("assistant");
    expect(parsed[1]!.toolCalls[0]!.name).toBe("Bash");
    expect(parsed[1]!.toolCalls[0]!.inputSummary).toBe("ls");
  });
});
