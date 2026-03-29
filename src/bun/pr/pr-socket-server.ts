// ============================================================
// PRSocketServer — HTTP-over-Unix-socket server with SSE streaming.
// Port of PRSocketServer.swift.
// Uses Bun.listen for the Unix socket server.
// ============================================================

import { unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Socket } from "bun";
import type { DraftPostBody } from "./pr-models";

// --- HTTP Request/Response helpers ---

interface HTTPRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

function parseHTTPRequest(raw: string): HTTPRequest | null {
  const parts = raw.split("\r\n\r\n");
  const headerSection = parts[0];
  if (!headerSection) return null;

  const headerLines = headerSection.split("\r\n");
  const requestLine = headerLines[0];
  if (!requestLine) return null;

  const requestParts = requestLine.split(" ");
  if (requestParts.length < 2) return null;
  const method = requestParts[0]!;
  const path = requestParts[1]!;

  const headers: Record<string, string> = {};
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i]!;
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  const rawBody = parts.length > 1 ? parts.slice(1).join("\r\n\r\n") : null;
  const body = rawBody && rawBody.length > 0 ? rawBody : null;

  return { method, path, headers, body };
}

function serializeResponse(
  statusCode: number,
  statusText: string,
  headers: Record<string, string>,
  body: string,
): string {
  let result = `HTTP/1.1 ${statusCode} ${statusText}\r\n`;
  for (const [key, value] of Object.entries(headers)) {
    result += `${key}: ${value}\r\n`;
  }
  result += "\r\n";
  result += body;
  return result;
}

function okResponse(body: string): string {
  return serializeResponse(
    200,
    "OK",
    {
      "Content-Type": "text/plain",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  );
}

function notFoundResponse(): string {
  const body = "Not Found";
  return serializeResponse(
    404,
    "Not Found",
    {
      "Content-Type": "text/plain",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  );
}

function sseHeadersResponse(): string {
  return serializeResponse(
    200,
    "OK",
    {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
    "",
  );
}

// --- SSE helpers ---

export function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export function extractWorkspace(path: string): string | null {
  const parts = path.split("/").filter((p) => p.length > 0);
  // Expect ["workspace", "{name}", ...]
  if (parts.length >= 2 && parts[0] === "workspace") {
    return parts[1]!;
  }
  return null;
}

// --- PRSocketServer ---

type SocketData = { buffer: string };

export class PRSocketServer {
  readonly socketPath: string;
  private server: ReturnType<typeof Bun.listen<SocketData>> | null = null;

  /** Active SSE client sockets keyed by workspace name. */
  private sseClients = new Map<string, Set<Socket<SocketData>>>();

  /** Callback invoked when a draft POST arrives. */
  onDraftReceived:
    | ((workspace: string, draft: DraftPostBody) => void)
    | null = null;

  constructor(socketPath?: string) {
    this.socketPath =
      socketPath ??
      `${process.env.HOME || "/tmp"}/.tempest/pr-channel.sock`;
  }

  start(): void {
    // Ensure parent directory exists
    const dir = dirname(this.socketPath);
    mkdirSync(dir, { recursive: true });

    // Clean up stale socket
    try {
      unlinkSync(this.socketPath);
    } catch {
      // ignore — may not exist
    }

    const self = this;

    this.server = Bun.listen<SocketData>({
      unix: this.socketPath,
      socket: {
        open(socket) {
          socket.data = { buffer: "" };
        },
        data(socket, data) {
          socket.data.buffer += data.toString();

          // Check if we have a complete HTTP request (headers end with \r\n\r\n)
          const headerEndIdx = socket.data.buffer.indexOf("\r\n\r\n");
          if (headerEndIdx === -1) return; // Need more data

          const request = parseHTTPRequest(socket.data.buffer);
          if (!request) {
            socket.write(notFoundResponse());
            socket.end();
            return;
          }

          // For POST, check if we have the full body
          if (request.method === "POST") {
            const contentLength = request.headers["Content-Length"];
            if (contentLength) {
              const expectedLen = parseInt(contentLength, 10);
              const bodyStart = headerEndIdx + 4;
              const currentBodyLen = socket.data.buffer.length - bodyStart;
              if (currentBodyLen < expectedLen) return; // Need more body data

              // Re-parse with full body
              const fullRequest = parseHTTPRequest(socket.data.buffer);
              if (fullRequest) {
                self.routeRequest(fullRequest, socket);
                return;
              }
            }
          }

          self.routeRequest(request, socket);
        },
        close(socket) {
          // Remove from SSE clients
          for (const [workspace, clients] of self.sseClients) {
            if (clients.has(socket)) {
              clients.delete(socket);
              if (clients.size === 0) {
                self.sseClients.delete(workspace);
              }
              break;
            }
          }
        },
        error(_socket, error) {
          console.error("[PRSocketServer] socket error:", error);
        },
      },
    });

    console.log(`[PRSocketServer] listening on ${this.socketPath}`);
  }

  stop(): void {
    // Close all SSE clients
    for (const [, clients] of this.sseClients) {
      for (const socket of clients) {
        try {
          socket.end();
        } catch {
          // ignore
        }
      }
    }
    this.sseClients.clear();

    if (this.server) {
      this.server.stop();
      this.server = null;
    }

    // Clean up socket file
    try {
      unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
  }

  /** Push a Server-Sent Event to all connected clients for the given workspace. */
  sendEvent(workspace: string, event: string, data: string): void {
    const clients = this.sseClients.get(workspace);
    if (!clients || clients.size === 0) return;

    const message = formatSSE(event, data);
    const dead: Socket<SocketData>[] = [];

    for (const socket of clients) {
      try {
        const written = socket.write(message);
        if (written === 0) {
          dead.push(socket);
        }
      } catch {
        dead.push(socket);
      }
    }

    for (const socket of dead) {
      clients.delete(socket);
      try {
        socket.end();
      } catch {
        // ignore
      }
    }

    if (clients.size === 0) {
      this.sseClients.delete(workspace);
    }
  }

  /** Check if there are any SSE clients connected for a workspace. */
  hasClients(workspace: string): boolean {
    const clients = this.sseClients.get(workspace);
    return !!clients && clients.size > 0;
  }

  // --- Private routing ---

  private routeRequest(request: HTTPRequest, socket: Socket<SocketData>): void {
    const workspace = extractWorkspace(request.path);
    if (!workspace) {
      socket.write(notFoundResponse());
      socket.end();
      return;
    }

    switch (request.method) {
      case "GET":
        // SSE connection — send headers and keep socket alive
        socket.write(sseHeadersResponse());

        if (!this.sseClients.has(workspace)) {
          this.sseClients.set(workspace, new Set());
        }
        this.sseClients.get(workspace)!.add(socket);
        // Socket intentionally NOT closed — stays open for SSE
        break;

      case "POST":
        this.handleDraftPost(request, workspace, socket);
        break;

      default:
        socket.write(notFoundResponse());
        socket.end();
        break;
    }
  }

  private handleDraftPost(
    request: HTTPRequest,
    workspace: string,
    socket: Socket<SocketData>,
  ): void {
    if (!request.body) {
      socket.write(notFoundResponse());
      socket.end();
      return;
    }

    try {
      const draft: DraftPostBody = JSON.parse(request.body);
      socket.write(okResponse("accepted"));
      socket.end();

      this.onDraftReceived?.(workspace, draft);
    } catch {
      socket.write(notFoundResponse());
      socket.end();
    }
  }
}
