#!/usr/bin/env bun
// TempestChannel — MCP server for PR review comment handling
// Runs inside Claude Code as an MCP stdio server.
// Receives PR review comments via SSE from Tempest's Unix socket server,
// and exposes a submit_draft tool for Claude to reply to PR comments.
//
// Implements MCP JSON-RPC 2.0 protocol inline (no SDK dependency).

import { connect } from "net";
import { PR_CHANNEL_SOCKET } from "../config/paths";

const SOCKET_PATH = process.env.TEMPEST_SOCKET_PATH || PR_CHANNEL_SOCKET;
const WORKSPACE = process.env.TEMPEST_WORKSPACE || "default";
const WORKSPACE_SEGMENT = encodeURIComponent(WORKSPACE);
const resolvedSocket = SOCKET_PATH.replace("~", process.env.HOME || "");

// --- Minimal MCP Server (JSON-RPC 2.0 over stdio) ---

const SERVER_INFO = { name: "tempest-pr", version: "0.0.1" };

const CAPABILITIES = {
  experimental: { "claude/channel": {} },
  tools: {},
};

const INSTRUCTIONS = `You are monitoring a pull request for review comments. Events arrive as <channel source="tempest-pr"> containing PR review comments from code reviewers.

When you receive a review comment:
1. Read and assess the comment: does it request a code change, ask a question, or make a suggestion you disagree with?
2. If a code change is warranted:
   a. Ensure clean repo state. For jj: check if the current change is empty and unnamed with \`jj status\`; if not, run \`jj new\`. For git: ensure the working directory is clean with \`git status\`.
   b. Implement the fix.
   c. Commit with a descriptive message. For jj: \`jj describe -m "message"\`. For git: \`git add <files> && git commit -m "message"\`.
   d. Get the commit ref. For jj: \`jj log -r @ --no-graph -T change_id\`. For git: \`git rev-parse HEAD\`.
   e. Call submit_draft with has_code_change: true and the commit_ref.
3. If it's a question: call submit_draft with has_code_change: false and a reply that answers the question.
4. If you disagree with the suggestion: call submit_draft with has_code_change: false and a reply explaining why the current approach is correct.

IMPORTANT: Never push code or post replies to GitHub directly. Always use submit_draft.`;

const SUBMIT_DRAFT_TOOL = {
  name: "submit_draft",
  description:
    "Submit a draft reply to a PR review comment for human approval. The reply will NOT be posted until approved.",
  inputSchema: {
    type: "object" as const,
    properties: {
      node_id: {
        type: "string",
        description: "GitHub node_id of the comment being replied to (from the channel event)",
      },
      reply_text: { type: "string", description: "The drafted reply text" },
      has_code_change: {
        type: "boolean",
        description: "Whether you made a commit for this",
      },
      commit_description: {
        type: "string",
        description: "What you changed and why (only if has_code_change is true)",
      },
      commit_ref: {
        type: "string",
        description:
          "The jj change-id or git SHA of the commit (only if has_code_change is true)",
      },
    },
    required: ["node_id", "reply_text", "has_code_change"],
  },
};

// Write a JSON-RPC response to stdout
export function sendResponse(id: number | string | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  // MCP uses Content-Length framed messages on stdio
  const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
  process.stdout.write(header + msg);
}

export function sendError(
  id: number | string | null,
  code: number,
  message: string,
): void {
  const msg = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
  process.stdout.write(header + msg);
}

export function sendNotification(method: string, params: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
  process.stdout.write(header + msg);
}

// Handle incoming JSON-RPC requests
export async function handleRequest(
  id: number | string | null,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
      break;

    case "initialized":
      // Client acknowledgment — no response needed (it's a notification)
      break;

    case "tools/list":
      sendResponse(id, { tools: [SUBMIT_DRAFT_TOOL] });
      break;

    case "tools/call": {
      const toolName = (params as { name?: string }).name;
      if (toolName === "submit_draft") {
        const args = (params as { arguments?: Record<string, unknown> })
          .arguments as {
          node_id: string;
          reply_text: string;
          has_code_change: boolean;
          commit_description?: string;
          commit_ref?: string;
        };

        try {
          await postDraft(args);
          sendResponse(id, {
            content: [
              {
                type: "text",
                text: "Draft submitted for review. It will be posted after human approval.",
              },
            ],
          });
        } catch (err) {
          sendResponse(id, {
            content: [
              { type: "text", text: `Failed to submit draft: ${err}` },
            ],
            isError: true,
          });
        }
      } else {
        sendError(id, -32601, `Unknown tool: ${toolName}`);
      }
      break;
    }

    case "ping":
      sendResponse(id, {});
      break;

    default:
      if (id !== null && id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      break;
  }
}

// --- Socket Communication ---

async function postDraft(draft: {
  node_id: string;
  reply_text: string;
  has_code_change: boolean;
  commit_description?: string;
  commit_ref?: string;
}): Promise<void> {
  const body = JSON.stringify({
    node_id: draft.node_id,
    reply_text: draft.reply_text,
    has_code_change: draft.has_code_change,
    commit_description: draft.commit_description ?? null,
    commit_ref: draft.commit_ref ?? null,
  });

  return new Promise((resolve, reject) => {
    const sock = connect(resolvedSocket, () => {
      const request = [
        `POST /workspace/${WORKSPACE_SEGMENT}/draft HTTP/1.1`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        `Content-Type: application/json`,
        "",
        body,
      ].join("\r\n");
      sock.write(request);
    });

    let response = "";
    sock.on("data", (data) => {
      response += data.toString();
    });
    sock.on("end", () => {
      if (response.includes("200")) resolve();
      else
        reject(
          new Error(`Server responded: ${response.split("\r\n")[0]}`),
        );
    });
    sock.on("error", reject);
  });
}

// --- SSE Parsing ---

export interface SSEEvent {
  type: string;
  data: string;
}

/** Strip HTTP response headers from a buffer. */
export function skipHTTPHeaders(buffer: string): {
  body: string;
  found: boolean;
} {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return { body: buffer, found: false };
  return { body: buffer.slice(headerEnd + 4), found: true };
}

/**
 * Parse SSE events from a buffer. Returns parsed events and any remaining
 * incomplete data. Handles multi-line data fields per the SSE spec.
 */
export function parseSSEBuffer(buffer: string): {
  events: SSEEvent[];
  remainder: string;
} {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() || "";
  const events: SSEEvent[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split("\n");
    let eventType = "";
    let eventData = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) eventType = line.slice(7);
      else if (line.startsWith("data: "))
        eventData += (eventData ? "\n" : "") + line.slice(6);
    }
    if (eventType && eventData) {
      events.push({ type: eventType, data: eventData });
    }
  }

  return { events, remainder };
}

// --- SSE Listener (receives events from Tempest) ---

export function createReconnectScheduler(
  connectFn: () => void,
  delayMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      connectFn();
    }, delayMs);
  };
}

let scheduleSSEReconnect: () => void = () => {};

function connectSSE(): void {
  const sock = connect(resolvedSocket, () => {
    const request = [
      `GET /workspace/${WORKSPACE_SEGMENT}/events HTTP/1.1`,
      `Accept: text/event-stream`,
      "",
      "",
    ].join("\r\n");
    sock.write(request);
  });

  let buffer = "";
  let headersParsed = false;

  sock.on("data", (data) => {
    buffer += data.toString();

    if (!headersParsed) {
      const result = skipHTTPHeaders(buffer);
      if (!result.found) return;
      buffer = result.body;
      headersParsed = true;
    }

    const { events, remainder } = parseSSEBuffer(buffer);
    buffer = remainder;

    for (const event of events) {
      forwardToChannel(event.type, event.data);
    }
  });

  sock.on("error", () => {
    scheduleSSEReconnect();
  });

  sock.on("close", () => {
    scheduleSSEReconnect();
  });
}

scheduleSSEReconnect = createReconnectScheduler(() => connectSSE(), 5000);

export function forwardToChannel(eventType: string, data: string): void {
  try {
    const parsed = JSON.parse(data);
    const author = parsed.author ?? "unknown";
    const body = parsed.body ?? "";
    const path = parsed.path ?? "";
    const line = parsed.line ?? null;
    const nodeId = parsed.node_id ?? "";

    sendNotification("notifications/claude/channel", {
      content: `Review comment from @${author} on ${path || "PR"}${line ? `:${line}` : ""}:\n\n${body}`,
      meta: {
        node_id: nodeId,
        author,
        path,
        line: String(line || ""),
        event_type: eventType,
      },
    });
  } catch (err) {
    // Log to stderr (visible in Claude Code debug logs) but don't crash
    console.error(`Failed to forward event: ${err}`);
  }
}

// --- Stdio Transport (Content-Length framed JSON-RPC) ---

export function parseContentLengthFrames(buffer: Uint8Array): {
  messages: string[];
  remainder: Uint8Array;
} {
  const data = Buffer.from(buffer);
  const messages: string[] = [];
  let offset = 0;

  while (true) {
    const headerEnd = data.indexOf("\r\n\r\n", offset, "utf8");
    if (headerEnd === -1) break;

    const headerSection = data.subarray(offset, headerEnd).toString("utf8");
    const contentLengthMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      // Malformed header — skip past it and keep scanning
      offset = headerEnd + 4;
      continue;
    }

    const contentLength = parseInt(contentLengthMatch[1]!, 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (data.length < bodyEnd) break; // Wait for more bytes

    const body = data.subarray(bodyStart, bodyEnd).toString("utf8");
    messages.push(body);
    offset = bodyEnd;
  }

  return {
    messages,
    remainder: data.subarray(offset),
  };
}

async function startStdioTransport(): Promise<void> {
  let pending = Buffer.alloc(0);
  const stream = Bun.stdin.stream();

  for await (const chunk of stream as any) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    const { messages, remainder } = parseContentLengthFrames(pending);
    pending = Buffer.from(remainder);

    for (const body of messages) {
      try {
        const msg = JSON.parse(body);
        if (msg.method) {
          await handleRequest(
            msg.id ?? null,
            msg.method,
            msg.params ?? {},
          );
        }
      } catch (err) {
        console.error(`Failed to parse message: ${err}`);
      }
    }
  }
}

// --- Start ---

if (import.meta.main) {
  startStdioTransport();
  connectSSE();
}
