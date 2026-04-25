// ============================================================
// JSON-RPC framing for LSP servers.
//
// LSP servers speak JSON-RPC 2.0 over stdio with Content-Length-prefixed
// frames. This module owns the wire format only — encoding, decoding, and
// type guards. Higher layers (server-process.ts) own the request/response
// correlation and the LSP-specific lifecycle.
// ============================================================

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  // A response always carries an id and either a result or an error field.
  // A request also carries an id but always has a method; pivot on method.
  return "id" in msg && !("method" in msg);
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "id" in msg && "method" in msg;
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !("id" in msg) && "method" in msg;
}

/**
 * Encode a single JSON-RPC message into the LSP wire format.
 * Always uses utf-8; the Content-Length header is the byte length, not the
 * string length — TextEncoder gives us that directly.
 */
export function encodeMessage(message: JsonRpcMessage): Uint8Array {
  const body = JSON.stringify(message);
  const bodyBytes = new TextEncoder().encode(body);
  const header = `Content-Length: ${bodyBytes.byteLength}\r\n\r\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
  out.set(headerBytes, 0);
  out.set(bodyBytes, headerBytes.byteLength);
  return out;
}

/**
 * Streaming decoder for Content-Length-framed JSON-RPC messages.
 *
 * LSP servers can split a message across multiple writes, and they can
 * coalesce multiple messages into one write. The decoder buffers raw bytes
 * and emits whole messages as they become available.
 *
 * Usage:
 *   const decoder = new MessageDecoder();
 *   for await (const chunk of stream) {
 *     for (const msg of decoder.push(chunk)) handle(msg);
 *   }
 */
export class MessageDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): JsonRpcMessage[] {
    // Append chunk to buffer. We grow the buffer in place rather than using
    // an array-of-chunks because LSP messages are usually small and copying
    // once per push is simpler than maintaining a chunk queue.
    const next = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.byteLength);
    this.buffer = next;

    const out: JsonRpcMessage[] = [];

    while (true) {
      const headerEnd = findHeaderTerminator(this.buffer);
      if (headerEnd === -1) break;

      const headerBytes = this.buffer.subarray(0, headerEnd);
      const headerText = new TextDecoder("ascii").decode(headerBytes);
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        // Malformed header — skip past the terminator so we don't loop forever.
        // Real servers won't hit this, but a corrupted byte from a crashing
        // child shouldn't wedge the decoder.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const bodyStart = headerEnd + 4; // \r\n\r\n
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < bodyEnd) break; // wait for more bytes

      const body = this.buffer.subarray(bodyStart, bodyEnd);
      const text = new TextDecoder("utf-8").decode(body);
      try {
        out.push(JSON.parse(text));
      } catch {
        // Non-JSON body — drop it and resync. Same rationale as malformed header.
      }

      this.buffer = this.buffer.subarray(bodyEnd);
    }

    return out;
  }
}

function findHeaderTerminator(buf: Uint8Array): number {
  // Look for \r\n\r\n. Header section is ASCII; byte-level scan is fine.
  for (let i = 0; i + 3 < buf.byteLength; i++) {
    if (
      buf[i] === 0x0d &&
      buf[i + 1] === 0x0a &&
      buf[i + 2] === 0x0d &&
      buf[i + 3] === 0x0a
    ) {
      return i;
    }
  }
  return -1;
}

function parseContentLength(headerText: string): number | null {
  for (const line of headerText.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (name !== "content-length") continue;
    const value = parseInt(line.slice(idx + 1).trim(), 10);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  return null;
}
