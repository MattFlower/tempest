// ============================================================
// McpHttpServer — MCP Streamable HTTP transport server.
// Runs inside Tempest's Bun process, serving MCP tools to Claude Code.
// Each Claude session connects via a unique URL path: /mcp/{workspace}
// ============================================================

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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

export class McpHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private port: number = 0;
  private token: string = "";

  /** Called when a show_webpage tool is invoked. */
  onShowWebpage: ((workspaceName: string, title: string, filePath: string) => void) | null = null;

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

        // Expect /mcp/{workspaceName}
        if (pathParts.length < 2 || pathParts[0] !== "mcp") {
          return new Response("Not Found", { status: 404 });
        }

        const workspaceName = decodeURIComponent(pathParts[1]!);

        if (req.method === "POST") {
          return self.handlePost(req, workspaceName);
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

    this.port = this.server.port;
    console.log(`[mcp-http] MCP server listening on http://127.0.0.1:${this.port}`);
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private async handlePost(req: Request, workspaceName: string): Promise<Response> {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Handle JSON-RPC batches
    if (Array.isArray(body)) {
      // Batch of notifications/responses — accept
      const hasRequests = body.some((m: any) => m.id !== undefined && m.method);
      if (!hasRequests) {
        return new Response(null, { status: 202 });
      }
      // We don't support batched requests — process first request only
      body = body.find((m: any) => m.id !== undefined && m.method) ?? body[0];
    }

    const { id, method, params } = body;

    // Notifications (no id) — accept
    if (id === undefined || id === null) {
      return new Response(null, { status: 202 });
    }

    // Handle JSON-RPC request
    const result = await this.handleRequest(method, params ?? {}, workspaceName);
    const response = JSON.stringify({ jsonrpc: "2.0", id, result });

    return new Response(response, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleRequest(
    method: string,
    params: Record<string, unknown>,
    workspaceName: string,
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
          return this.handleShowWebpage(params, workspaceName);
        }
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
      }

      case "ping":
        return {};

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  }

  private async handleShowWebpage(
    params: Record<string, unknown>,
    workspaceName: string,
  ): Promise<unknown> {
    const args = (params as { arguments?: Record<string, unknown> }).arguments as {
      html: string;
      title: string;
    };

    try {
      const previewDir = join(WEBPAGE_PREVIEWS_DIR, workspaceName);
      await mkdir(previewDir, { recursive: true });

      const fileId = crypto.randomUUID();
      const filePath = join(previewDir, `${fileId}.html`);
      await Bun.write(filePath, args.html);

      this.onShowWebpage?.(workspaceName, args.title, filePath);

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
