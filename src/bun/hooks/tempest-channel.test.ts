import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  parseSSEBuffer,
  skipHTTPHeaders,
  parseContentLengthFrames,
  createReconnectScheduler,
  handleRequest,
  sendResponse,
  sendError,
  sendNotification,
  forwardToChannel,
} from "./tempest-channel";

// --- stdout capture helper ---

function captureStdout(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    messages.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    messages,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

/** Parse a Content-Length framed MCP message from captured stdout. */
function parseFramedMessage(raw: string): unknown {
  const match = raw.match(/Content-Length:\s*(\d+)\r\n\r\n([\s\S]*)/);
  if (!match) throw new Error(`Not a framed message: ${raw}`);
  const body = match[2]!.slice(0, parseInt(match[1]!, 10));
  return JSON.parse(body);
}

// ============================================================
// skipHTTPHeaders
// ============================================================

describe("skipHTTPHeaders", () => {
  it("returns body after headers when headers are complete", () => {
    const input = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\nSSE data here";
    const result = skipHTTPHeaders(input);
    expect(result.found).toBe(true);
    expect(result.body).toBe("SSE data here");
  });

  it("returns found=false when headers are incomplete", () => {
    const input = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream";
    const result = skipHTTPHeaders(input);
    expect(result.found).toBe(false);
    expect(result.body).toBe(input);
  });

  it("handles empty body after headers", () => {
    const input = "HTTP/1.1 200 OK\r\n\r\n";
    const result = skipHTTPHeaders(input);
    expect(result.found).toBe(true);
    expect(result.body).toBe("");
  });

  it("handles empty input", () => {
    const result = skipHTTPHeaders("");
    expect(result.found).toBe(false);
    expect(result.body).toBe("");
  });
});

// ============================================================
// parseSSEBuffer
// ============================================================

describe("parseSSEBuffer", () => {
  it("parses a single complete event", () => {
    const input = "event: new_comment\ndata: {\"author\":\"alice\"}\n\n";
    const { events, remainder } = parseSSEBuffer(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("new_comment");
    expect(events[0]!.data).toBe('{"author":"alice"}');
    expect(remainder).toBe("");
  });

  it("parses multiple complete events", () => {
    const input =
      "event: new_comment\ndata: {\"id\":1}\n\n" +
      "event: new_comment\ndata: {\"id\":2}\n\n";
    const { events, remainder } = parseSSEBuffer(input);
    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe('{"id":1}');
    expect(events[1]!.data).toBe('{"id":2}');
    expect(remainder).toBe("");
  });

  it("returns incomplete event as remainder", () => {
    const input = "event: new_comment\ndata: {\"id\":1}\n\nevent: partial";
    const { events, remainder } = parseSSEBuffer(input);
    expect(events).toHaveLength(1);
    expect(remainder).toBe("event: partial");
  });

  it("handles multi-line data fields per SSE spec", () => {
    const input = "event: message\ndata: line one\ndata: line two\ndata: line three\n\n";
    const { events } = parseSSEBuffer(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("line one\nline two\nline three");
  });

  it("skips events without a type", () => {
    const input = "data: no type here\n\n";
    const { events } = parseSSEBuffer(input);
    expect(events).toHaveLength(0);
  });

  it("skips events without data", () => {
    const input = "event: empty\n\n";
    const { events } = parseSSEBuffer(input);
    expect(events).toHaveLength(0);
  });

  it("skips whitespace-only chunks", () => {
    const input = "  \n\nevent: real\ndata: yes\n\n";
    const { events } = parseSSEBuffer(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("real");
  });

  it("handles empty buffer", () => {
    const { events, remainder } = parseSSEBuffer("");
    expect(events).toHaveLength(0);
    expect(remainder).toBe("");
  });

  it("buffer with no complete events returns everything as remainder", () => {
    const input = "event: incomplete\ndata: still waiting";
    const { events, remainder } = parseSSEBuffer(input);
    expect(events).toHaveLength(0);
    expect(remainder).toBe(input);
  });
});

// ============================================================
// parseContentLengthFrames
// ============================================================

describe("parseContentLengthFrames", () => {
  it("parses framed messages using byte lengths (unicode-safe)", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { emoji: "😀" },
    });
    const framed = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    const { messages, remainder } = parseContentLengthFrames(Buffer.from(framed));
    expect(messages).toEqual([body]);
    expect(remainder.length).toBe(0);
  });

  it("returns incomplete data in remainder", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    const framed = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const partial = Buffer.from(framed).subarray(0, framed.length - 2);

    const { messages, remainder } = parseContentLengthFrames(partial);
    expect(messages).toHaveLength(0);
    expect(Buffer.from(remainder).equals(partial)).toBe(true);
  });
});

// ============================================================
// createReconnectScheduler
// ============================================================

describe("createReconnectScheduler", () => {
  it("deduplicates reconnect scheduling until the timer fires", async () => {
    let calls = 0;
    const schedule = createReconnectScheduler(() => {
      calls += 1;
    }, 10);

    schedule();
    schedule();
    schedule();
    await Bun.sleep(25);
    expect(calls).toBe(1);

    schedule();
    await Bun.sleep(25);
    expect(calls).toBe(2);
  });
});

// ============================================================
// sendResponse / sendError / sendNotification
// ============================================================

describe("MCP message framing", () => {
  let captured: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
  });

  describe("sendResponse", () => {
    it("sends Content-Length framed JSON-RPC response", () => {
      sendResponse(1, { key: "value" });
      expect(captured.messages).toHaveLength(1);
      const parsed = parseFramedMessage(captured.messages[0]!) as any;
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.id).toBe(1);
      expect(parsed.result).toEqual({ key: "value" });
    });

    it("handles string ids", () => {
      sendResponse("abc-123", {});
      const parsed = parseFramedMessage(captured.messages[0]!) as any;
      expect(parsed.id).toBe("abc-123");
    });

    it("handles null id", () => {
      sendResponse(null, {});
      const parsed = parseFramedMessage(captured.messages[0]!) as any;
      expect(parsed.id).toBeNull();
    });

    it("Content-Length matches actual byte length", () => {
      sendResponse(1, { emoji: "\u{1F600}" });
      const raw = captured.messages[0]!;
      const match = raw.match(/Content-Length:\s*(\d+)\r\n\r\n([\s\S]*)/);
      const declaredLength = parseInt(match![1]!, 10);
      const actualBody = match![2]!;
      expect(Buffer.byteLength(actualBody)).toBe(declaredLength);
    });
  });

  describe("sendError", () => {
    it("sends JSON-RPC error with code and message", () => {
      sendError(42, -32601, "Method not found");
      const parsed = parseFramedMessage(captured.messages[0]!) as any;
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.id).toBe(42);
      expect(parsed.error.code).toBe(-32601);
      expect(parsed.error.message).toBe("Method not found");
      expect(parsed.result).toBeUndefined();
    });
  });

  describe("sendNotification", () => {
    it("sends JSON-RPC notification (no id)", () => {
      sendNotification("notifications/test", { foo: "bar" });
      const parsed = parseFramedMessage(captured.messages[0]!) as any;
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("notifications/test");
      expect(parsed.params).toEqual({ foo: "bar" });
      expect(parsed.id).toBeUndefined();
    });
  });
});

// ============================================================
// handleRequest
// ============================================================

describe("handleRequest", () => {
  let captured: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
  });

  it("initialize returns protocol version, capabilities, and server info", async () => {
    await handleRequest(1, "initialize", {});
    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.result.protocolVersion).toBe("2024-11-05");
    expect(parsed.result.capabilities.experimental["claude/channel"]).toBeDefined();
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.serverInfo.name).toBe("tempest-pr");
    expect(parsed.result.serverInfo.version).toBe("0.0.1");
    expect(parsed.result.instructions).toContain("monitoring a pull request");
  });

  it("initialized notification produces no response", async () => {
    await handleRequest(null, "initialized", {});
    expect(captured.messages).toHaveLength(0);
  });

  it("tools/list returns submit_draft tool", async () => {
    await handleRequest(2, "tools/list", {});
    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    const tools = parsed.result.tools;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("submit_draft");
    expect(tools[0].inputSchema.required).toEqual([
      "node_id",
      "reply_text",
      "has_code_change",
    ]);
  });

  it("tools/call with unknown tool returns error", async () => {
    await handleRequest(3, "tools/call", { name: "nonexistent" });
    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("Unknown tool");
  });

  it("ping returns empty result", async () => {
    await handleRequest(4, "ping", {});
    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.id).toBe(4);
    expect(parsed.result).toEqual({});
  });

  it("unknown method with id returns method-not-found error", async () => {
    await handleRequest(5, "some/unknown/method", {});
    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("Method not found");
  });

  it("unknown method without id (notification) produces no response", async () => {
    await handleRequest(null, "some/unknown/notification", {});
    expect(captured.messages).toHaveLength(0);
  });
});

// ============================================================
// forwardToChannel
// ============================================================

describe("forwardToChannel", () => {
  let captured: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
  });

  it("sends MCP channel notification with correct format", () => {
    const data = JSON.stringify({
      node_id: "abc123",
      author: "reviewer",
      body: "Please fix the null check",
      path: "src/main.ts",
      line: 42,
    });

    forwardToChannel("new_comment", data);

    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.method).toBe("notifications/claude/channel");
    expect(parsed.params.content).toContain("@reviewer");
    expect(parsed.params.content).toContain("src/main.ts:42");
    expect(parsed.params.content).toContain("Please fix the null check");
    expect(parsed.params.meta.node_id).toBe("abc123");
    expect(parsed.params.meta.author).toBe("reviewer");
    expect(parsed.params.meta.path).toBe("src/main.ts");
    expect(parsed.params.meta.line).toBe("42");
    expect(parsed.params.meta.event_type).toBe("new_comment");
  });

  it("uses 'PR' when path is missing", () => {
    const data = JSON.stringify({
      node_id: "n1",
      author: "bob",
      body: "Looks good",
    });

    forwardToChannel("comment", data);

    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.params.content).toContain("on PR");
    expect(parsed.params.meta.path).toBe("");
  });

  it("omits line number when line is missing", () => {
    const data = JSON.stringify({
      node_id: "n2",
      author: "alice",
      body: "Nice work",
      path: "README.md",
    });

    forwardToChannel("comment", data);

    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.params.content).toContain("on README.md:\n");
    // No line number suffix like ":42" after the path
    expect(parsed.params.content).not.toMatch(/README\.md:\d/);
    expect(parsed.params.meta.line).toBe("");
  });

  it("handles missing fields with safe defaults", () => {
    const data = JSON.stringify({});

    forwardToChannel("event", data);

    const parsed = parseFramedMessage(captured.messages[0]!) as any;
    expect(parsed.params.content).toContain("@unknown");
    expect(parsed.params.content).toContain("on PR");
    expect(parsed.params.meta.node_id).toBe("");
    expect(parsed.params.meta.author).toBe("unknown");
  });

  it("does not throw on invalid JSON", () => {
    const stderrMock = mock(() => {});
    const originalError = console.error;
    console.error = stderrMock;

    expect(() => forwardToChannel("event", "not json")).not.toThrow();
    expect(captured.messages).toHaveLength(0);
    expect(stderrMock).toHaveBeenCalled();

    console.error = originalError;
  });
});
