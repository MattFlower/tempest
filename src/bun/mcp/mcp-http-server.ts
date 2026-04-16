// ============================================================
// McpHttpServer — MCP Streamable HTTP transport server.
// Runs inside Tempest's Bun process, serving MCP tools to Claude Code.
// Each Claude session connects via a unique URL path: /mcp/{workspaceKey}
// ============================================================

import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { WEBPAGE_PREVIEWS_DIR } from "../config/paths";

const INSTRUCTIONS = `You are running inside Tempest, a developer tool with a pane-based UI. The user can see browser panes alongside their terminal.

When discussing UI designs, frontend layouts, visual architecture, or anything that would be clearer as a visual than as text — proactively use show_webpage to render an HTML preview for the user. This is especially valuable during planning: instead of describing a proposed UI in words, show it.

You can call this tool multiple times to iterate on a design based on user feedback.

Technical notes:
- The HTML renders in a browser pane next to the conversation
- Use a complete HTML document with inline CSS (no external stylesheets)
- SVGs, canvas, and standard JS all work`;

const SERVER_INFO = { name: "tempest-webpage", version: "0.0.1" };

const SHOW_WEBPAGE_TOOL = {
  name: "show_webpage",
  description:
    "Show HTML content to the user in a browser pane next to the conversation. Prefer this over describing UI designs, layouts, or visual architecture in text. Call multiple times to iterate on a design.",
  inputSchema: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description: "Complete HTML document content (should include <!DOCTYPE html> and all required tags)",
      },
      title: {
        type: "string",
        description: "Title for the browser tab (e.g. 'Login Page Mockup', 'Architecture Diagram')",
      },
    },
    required: ["html", "title"],
  },
};

class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class McpHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private port: number = 0;
  private token: string = "";

  /** Called when a show_webpage tool is invoked. */
  onShowWebpage: ((workspaceKey: string, title: string, filePath: string) => void) | null = null;

  getPort(): number {
    return this.port;
  }

  getToken(): string {
    return this.token;
  }

  start(): void {
    const self = this;
    this.token = randomBytes(32).toString("hex");

    this.server = Bun.serve({
      port: 0, // Let OS pick an available port
      hostname: "127.0.0.1",
      async fetch(req: Request): Promise<Response> {
        // Validate bearer token
        const auth = req.headers.get("Authorization");
        if (auth !== `Bearer ${self.token}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(req.url);
        const pathParts = url.pathname.split("/").filter(Boolean);

        // Expect /mcp/{workspaceKey}
        if (pathParts.length < 2 || pathParts[0] !== "mcp") {
          return new Response("Not Found", { status: 404 });
        }

        let workspaceKey: string;
        try {
          workspaceKey = decodeURIComponent(pathParts[1]!);
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        if (!self.isValidWorkspaceKey(workspaceKey)) {
          return new Response("Bad Request", { status: 400 });
        }

        if (req.method === "POST") {
          return self.handlePost(req, workspaceKey);
        }

        if (req.method === "GET") {
          // We don't support server-initiated SSE streams
          return new Response("Method Not Allowed", { status: 405 });
        }

        if (req.method === "DELETE") {
          // Session termination — just acknowledge
          return new Response(null, { status: 200 });
        }

        return new Response("Method Not Allowed", { status: 405 });
      },
    });

    this.port = this.server?.port ?? 0;
    console.log(`[mcp-http] MCP server listening on http://127.0.0.1:${this.port}`);
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private jsonRpcResponse(payload: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private jsonRpcError(id: unknown, code: number, message: string, status = 200): Response {
    return this.jsonRpcResponse(
      {
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code, message },
      },
      status,
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // JSON-RPC 2.0 allows array params, but MCP always uses object params.
  private normalizeParams(params: unknown): Record<string, unknown> {
    return this.isRecord(params) ? params : {};
  }

  private toJsonRpcError(err: unknown): { code: number; message: string } {
    if (err instanceof JsonRpcError) {
      return { code: err.code, message: err.message };
    }

    if (err instanceof Error) {
      return { code: -32603, message: err.message };
    }

    return { code: -32603, message: String(err) };
  }

  private isValidWorkspaceKey(workspaceKey: string): boolean {
    if (!workspaceKey) return false;
    if (workspaceKey === "." || workspaceKey === "..") return false;
    if (workspaceKey.includes("/") || workspaceKey.includes("\\")) return false;
    if (workspaceKey.includes("\0")) return false;
    return true;
  }

  private async handlePost(req: Request, workspaceKey: string): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return this.jsonRpcError(null, -32700, "Parse error", 400);
    }

    if (Array.isArray(body)) {
      return this.jsonRpcError(null, -32600, "Batch requests are not supported", 400);
    }

    if (!this.isRecord(body)) {
      return this.jsonRpcError(null, -32600, "Invalid Request", 400);
    }

    const id = body.id;
    const method = body.method;
    const params = this.normalizeParams(body.params);

    if (typeof method !== "string" || method.length === 0) {
      return this.jsonRpcError(id ?? null, -32600, "Invalid Request", 400);
    }

    // Notifications (no id) — accept
    if (id === undefined || id === null) {
      return new Response(null, { status: 202 });
    }

    try {
      const result = await this.handleRequest(method, params, workspaceKey);
      return this.jsonRpcResponse({ jsonrpc: "2.0", id, result }, 200);
    } catch (err) {
      const parsedError = this.toJsonRpcError(err);
      return this.jsonRpcError(id, parsedError.code, parsedError.message, 200);
    }
  }

  private async handleRequest(
    method: string,
    params: Record<string, unknown>,
    workspaceKey: string,
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        };

      case "tools/list":
        return { tools: [SHOW_WEBPAGE_TOOL] };

      case "tools/call": {
        const toolName = (params as { name?: string }).name;
        if (toolName === "show_webpage") {
          return this.handleShowWebpage(params, workspaceKey);
        }
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
      }

      case "ping":
        return {};

      default:
        throw new JsonRpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async handleShowWebpage(
    params: Record<string, unknown>,
    workspaceKey: string,
  ): Promise<unknown> {
    const args = (params as { arguments?: Record<string, unknown> }).arguments as {
      html: string;
      title: string;
    };

    try {
      const previewDir = join(WEBPAGE_PREVIEWS_DIR, workspaceKey);
      await mkdir(previewDir, { recursive: true });

      const fileId = crypto.randomUUID();
      const filePath = join(previewDir, `${fileId}.html`);
      await Bun.write(filePath, args.html);

      this.onShowWebpage?.(workspaceKey, args.title, filePath);

      return {
        content: [{ type: "text", text: "Webpage displayed to the user in a new browser pane." }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to show webpage: ${err}` }],
        isError: true,
      };
    }
  }
}
