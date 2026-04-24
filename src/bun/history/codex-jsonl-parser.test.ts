import { describe, expect, it } from "bun:test";
import {
  parseLine,
  parseSessionHeader,
  extractToolSummary,
  normalizeToolName,
} from "./codex-jsonl-parser";

describe("codex-jsonl-parser.parseLine", () => {
  it("reads cwd, timestamp, and id from a session_meta header", () => {
    const line = JSON.stringify({
      type: "session_meta",
      id: "abc-123",
      timestamp: "2026-01-02T03:04:05Z",
      cwd: "/Users/me/code/project",
    });
    const result = parseLine(line);
    expect(result.kind).toBe("header");
    if (result.kind !== "header") return;
    expect(result.cwd).toBe("/Users/me/code/project");
    expect(result.timestamp).toBe("2026-01-02T03:04:05Z");
    expect(result.id).toBe("abc-123");
  });

  it("also reads session_meta from a payload sub-object", () => {
    const line = JSON.stringify({
      type: "session_meta",
      timestamp: "2026-01-02T03:04:05Z",
      payload: { id: "def-456", cwd: "/tmp/ws" },
    });
    const header = parseSessionHeader(line);
    expect(header?.id).toBe("def-456");
    expect(header?.cwd).toBe("/tmp/ws");
  });

  it("parses a user response_item message with plain string content", () => {
    const line = JSON.stringify({
      type: "response_item",
      timestamp: "2026-01-02T03:04:05Z",
      item: { type: "message", role: "user", content: "hello codex" },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.type).toBe("user");
    expect(result.message.textContent).toBe("hello codex");
    expect(result.message.toolCalls).toEqual([]);
  });

  it("parses assistant output_text content blocks", () => {
    const line = JSON.stringify({
      type: "response_item",
      item: {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "done." },
          { type: "output_text", text: "shipping it." },
        ],
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.textContent).toBe("done.\nshipping it.");
  });

  it("normalizes a shell function_call into a TitleCased Bash tool call", () => {
    const line = JSON.stringify({
      type: "response_item",
      item: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["ls", "-la"] }),
      },
    });
    const result = parseLine(line);
    expect(result.kind).toBe("message");
    if (result.kind !== "message") return;
    expect(result.message.toolCalls).toHaveLength(1);
    const tc = result.message.toolCalls[0]!;
    expect(tc.name).toBe("Bash");
    expect(tc.inputSummary).toBe("ls -la");
    expect(tc.fullInput).toContain("ls");
  });

  it("normalizes apply_patch to Edit and read_file to Read", () => {
    expect(normalizeToolName("apply_patch")).toBe("Edit");
    expect(normalizeToolName("read_file")).toBe("Read");
    expect(normalizeToolName("write_file")).toBe("Write");
    expect(normalizeToolName("shell")).toBe("Bash");
    expect(normalizeToolName("custom_tool")).toBe("Custom_tool");
  });

  it("summarizes tool arguments sensibly", () => {
    expect(extractToolSummary("shell", { command: ["echo", "hi"] })).toBe(
      "echo hi",
    );
    expect(extractToolSummary("read_file", { path: "/a/b" })).toBe("/a/b");
    expect(
      extractToolSummary("apply_patch", { input: "--- a/x\n+++ b/x\n" }),
    ).toBe("--- a/x");
  });

  it("skips reasoning items and event_msg envelopes", () => {
    const reasoning = JSON.stringify({
      type: "response_item",
      item: { type: "reasoning", summary: "..." },
    });
    const event = JSON.stringify({ type: "event_msg", level: "info" });
    expect(parseLine(reasoning).kind).toBe("skipped");
    expect(parseLine(event).kind).toBe("skipped");
  });
});
