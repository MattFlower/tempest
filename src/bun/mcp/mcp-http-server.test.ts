import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpHttpServer } from "./mcp-http-server";

// Route filesystem writes into a tmp dir via constructor options, so we never
// touch the user's real ~/.config/tempest tree during tests.
const TMP_DIR = mkdtempSync(join(tmpdir(), "tempest-mcp-test-"));
const TMP_MERMAID_DIR = join(TMP_DIR, "mermaid-diagrams");
const TMP_WEBPAGE_DIR = join(TMP_DIR, "webpage-previews");
const TMP_MARKDOWN_DIR = join(TMP_DIR, "markdown-previews");

describe("McpHttpServer", () => {
  let server: McpHttpServer;
  let baseUrl: string;
  let token: string;

  beforeEach(() => {
    server = new McpHttpServer({
      webpagePreviewsDir: TMP_WEBPAGE_DIR,
      mermaidDiagramsDir: TMP_MERMAID_DIR,
      markdownPreviewsDir: TMP_MARKDOWN_DIR,
    });
    server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;
    token = server.getToken();
  });

  afterEach(() => {
    server.stop();
  });

  afterAll(() => {
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  });

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("handles a ping request successfully", async () => {
    const response = await post("/mcp/default", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as any;
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({});
    expect(parsed.error).toBeUndefined();
  });

  it("returns 401 for requests with wrong token", async () => {
    const response = await fetch(`${baseUrl}/mcp/default`, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns Parse error for non-JSON body", async () => {
    const response = await fetch(`${baseUrl}/mcp/default`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "not json",
    });

    expect(response.status).toBe(400);
    const parsed = (await response.json()) as any;
    expect(parsed.error.code).toBe(-32700);
    expect(parsed.error.message).toBe("Parse error");
  });

  it("accepts notifications with 202", async () => {
    const response = await post("/mcp/default", {
      jsonrpc: "2.0",
      method: "ping",
    });

    expect(response.status).toBe(202);
  });

  it("rejects invalid workspace keys to prevent path traversal", async () => {
    // Encoded slash decodes to "/tmp", which must be rejected as an invalid workspace key.
    const response = await post("/mcp/%2Ftmp", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Bad Request");
  });

  it("returns JSON-RPC error for unknown methods instead of transport failure", async () => {
    const response = await post("/mcp/default", {
      jsonrpc: "2.0",
      id: 42,
      method: "unknown/method",
      params: {},
    });

    expect(response.status).toBe(200);
    const parsed = await response.json() as any;
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(42);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("Method not found");
  });

  it("returns Invalid Request for non-object JSON bodies", async () => {
    const response = await post("/mcp/default", null);

    expect(response.status).toBe(400);
    const parsed = await response.json() as any;
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32600);
    expect(parsed.error.message).toBe("Invalid Request");
  });

  it("rejects JSON-RPC batch requests instead of partially processing", async () => {
    const response = await post("/mcp/default", [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);

    expect(response.status).toBe(400);
    const parsed = await response.json() as any;
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32600);
    expect(parsed.error.message).toContain("Batch requests are not supported");
  });

  it("show_webpage creates a file and invokes the callback with a UUID", async () => {
    let capture: { workspaceKey: string; title: string; filePath: string; pageId: string } | null = null;
    server.onShowWebpage = (workspaceKey, title, filePath, pageId) => {
      capture = { workspaceKey, title, filePath, pageId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_webpage",
        arguments: { html: "<!DOCTYPE html><html><body>v1</body></html>", title: "Page" },
      },
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as any;
    expect(parsed.result.isError).toBeFalsy();
    const text = parsed.result.content[0].text as string;

    expect(capture).not.toBeNull();
    expect(capture!.workspaceKey).toBe("test-ws");
    expect(capture!.title).toBe("Page");
    expect(capture!.pageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(text).toContain(capture!.pageId);
    expect(capture!.filePath).toBe(join(TMP_WEBPAGE_DIR, "test-ws", `${capture!.pageId}.html`));

    expect(existsSync(capture!.filePath)).toBe(true);
    expect(readFileSync(capture!.filePath, "utf-8")).toContain("v1");
  });

  it("show_webpage overwrites the same file on update and uses the caller's page_id", async () => {
    let capture: { filePath: string; pageId: string } | null = null;
    server.onShowWebpage = (_ws, _title, filePath, pageId) => {
      capture = { filePath, pageId };
    };

    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_webpage",
        arguments: { html: "<!DOCTYPE html><html><body>v1</body></html>", title: "Page" },
      },
    });
    const firstCapture = capture!;

    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "show_webpage",
        arguments: {
          html: "<!DOCTYPE html><html><body>v2 updated</body></html>",
          title: "Page v2",
          page_id: firstCapture.pageId,
        },
      },
    });
    const secondCapture = capture!;

    expect(secondCapture.pageId).toBe(firstCapture.pageId);
    expect(secondCapture.filePath).toBe(firstCapture.filePath);
    expect(readFileSync(secondCapture.filePath, "utf-8")).toContain("v2 updated");
  });

  it("show_webpage rejects a path-traversal page_id and mints a fresh UUID", async () => {
    let capture: { filePath: string; pageId: string } | null = null;
    server.onShowWebpage = (_ws, _title, filePath, pageId) => {
      capture = { filePath, pageId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_webpage",
        arguments: {
          html: "<!DOCTYPE html><html><body>x</body></html>",
          title: "Page",
          page_id: "../../../etc/passwd",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(capture!.pageId).not.toBe("../../../etc/passwd");
    expect(capture!.pageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(capture!.filePath.startsWith(join(TMP_WEBPAGE_DIR, "test-ws") + "/")).toBe(true);
  });

  it("lists all three show_* tools", async () => {
    const response = await post("/mcp/default", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as any;
    const names = parsed.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["show_markdown", "show_mermaid_diagram", "show_webpage"]);
  });

  it("show_mermaid_diagram creates a file and invokes the callback with a UUID", async () => {
    let capture: { workspaceKey: string; title: string; filePath: string; diagramId: string } | null = null;
    server.onShowMermaidDiagram = (workspaceKey, title, filePath, diagramId) => {
      capture = { workspaceKey, title, filePath, diagramId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_mermaid_diagram",
        arguments: { diagram: "graph LR; A-->B", title: "Flow" },
      },
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as any;
    expect(parsed.result.isError).toBeFalsy();
    const text = parsed.result.content[0].text as string;

    expect(capture).not.toBeNull();
    expect(capture!.workspaceKey).toBe("test-ws");
    expect(capture!.title).toBe("Flow");
    expect(capture!.diagramId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(text).toContain(capture!.diagramId);
    expect(capture!.filePath).toBe(join(TMP_MERMAID_DIR, "test-ws", `${capture!.diagramId}.html`));

    expect(existsSync(capture!.filePath)).toBe(true);
    const html = readFileSync(capture!.filePath, "utf-8");
    expect(html).toContain("graph LR; A--&gt;B"); // HTML-escaped
    expect(html).toContain("mermaid.initialize"); // inlined runtime + init
  });

  it("show_mermaid_diagram overwrites the same file on update and uses the caller's diagram_id", async () => {
    let capture: { filePath: string; diagramId: string } | null = null;
    server.onShowMermaidDiagram = (_ws, _title, filePath, diagramId) => {
      capture = { filePath, diagramId };
    };

    // First call: create.
    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_mermaid_diagram",
        arguments: { diagram: "graph LR; A-->B", title: "Flow" },
      },
    });
    const firstCapture = capture!;

    // Second call: update using the returned diagram_id.
    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "show_mermaid_diagram",
        arguments: {
          diagram: "graph LR; A-->B; B-->C",
          title: "Flow v2",
          diagram_id: firstCapture.diagramId,
        },
      },
    });
    const secondCapture = capture!;

    expect(secondCapture.diagramId).toBe(firstCapture.diagramId);
    expect(secondCapture.filePath).toBe(firstCapture.filePath);
    const html = readFileSync(secondCapture.filePath, "utf-8");
    expect(html).toContain("B--&gt;C"); // updated content on disk
  });

  it("show_mermaid_diagram rejects a path-traversal diagram_id and mints a fresh UUID", async () => {
    let capture: { filePath: string; diagramId: string } | null = null;
    server.onShowMermaidDiagram = (_ws, _title, filePath, diagramId) => {
      capture = { filePath, diagramId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_mermaid_diagram",
        arguments: {
          diagram: "graph LR; A-->B",
          title: "Flow",
          diagram_id: "../../../etc/passwd",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(capture!.diagramId).not.toBe("../../../etc/passwd");
    expect(capture!.diagramId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // File must live inside the workspace dir, not escape it.
    expect(capture!.filePath.startsWith(join(TMP_MERMAID_DIR, "test-ws") + "/")).toBe(true);
  });

  it("show_markdown creates a file, renders to HTML, and invokes the callback with a UUID", async () => {
    let capture: { workspaceKey: string; title: string; filePath: string; markdownId: string } | null = null;
    server.onShowMarkdown = (workspaceKey, title, filePath, markdownId) => {
      capture = { workspaceKey, title, filePath, markdownId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_markdown",
        arguments: { markdown: "# Hello\n\nSome **bold** text.", title: "Notes" },
      },
    });

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as any;
    expect(parsed.result.isError).toBeFalsy();
    const text = parsed.result.content[0].text as string;

    expect(capture).not.toBeNull();
    expect(capture!.workspaceKey).toBe("test-ws");
    expect(capture!.title).toBe("Notes");
    expect(capture!.markdownId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(text).toContain(capture!.markdownId);
    expect(capture!.filePath).toBe(join(TMP_MARKDOWN_DIR, "test-ws", `${capture!.markdownId}.html`));

    expect(existsSync(capture!.filePath)).toBe(true);
    const html = readFileSync(capture!.filePath, "utf-8");
    // buildMarkdownHTML produced real rendered output, not raw markdown.
    expect(html).toContain("<h1"); // rendered heading
    expect(html).toContain("<strong>bold</strong>"); // rendered emphasis
    expect(html).not.toContain("# Hello\n"); // raw markdown NOT present
  });

  it("show_markdown overwrites the same file on update and uses the caller's markdown_id", async () => {
    let capture: { filePath: string; markdownId: string } | null = null;
    server.onShowMarkdown = (_ws, _title, filePath, markdownId) => {
      capture = { filePath, markdownId };
    };

    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_markdown",
        arguments: { markdown: "# v1", title: "Notes" },
      },
    });
    const firstCapture = capture!;

    await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "show_markdown",
        arguments: {
          markdown: "# v2 updated",
          title: "Notes v2",
          markdown_id: firstCapture.markdownId,
        },
      },
    });
    const secondCapture = capture!;

    expect(secondCapture.markdownId).toBe(firstCapture.markdownId);
    expect(secondCapture.filePath).toBe(firstCapture.filePath);
    expect(readFileSync(secondCapture.filePath, "utf-8")).toContain("v2 updated");
  });

  it("show_markdown rejects a path-traversal markdown_id and mints a fresh UUID", async () => {
    let capture: { filePath: string; markdownId: string } | null = null;
    server.onShowMarkdown = (_ws, _title, filePath, markdownId) => {
      capture = { filePath, markdownId };
    };

    const response = await post("/mcp/test-ws", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "show_markdown",
        arguments: {
          markdown: "hi",
          title: "Notes",
          markdown_id: "../../../etc/passwd",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(capture!.markdownId).not.toBe("../../../etc/passwd");
    expect(capture!.markdownId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(capture!.filePath.startsWith(join(TMP_MARKDOWN_DIR, "test-ws") + "/")).toBe(true);
  });

  describe("isToolEnabled filtering", () => {
    // Use a dedicated server per test so the predicate under test is
    // isolated from the default beforeEach server.
    let gated: McpHttpServer;
    let gatedUrl: string;
    let gatedToken: string;
    let enabledSet: Set<string>;

    beforeEach(() => {
      enabledSet = new Set(["show_webpage", "show_mermaid_diagram", "show_markdown"]);
      gated = new McpHttpServer({
        webpagePreviewsDir: TMP_WEBPAGE_DIR,
        mermaidDiagramsDir: TMP_MERMAID_DIR,
        markdownPreviewsDir: TMP_MARKDOWN_DIR,
        isToolEnabled: (name) => enabledSet.has(name),
      });
      gated.start();
      gatedUrl = `http://127.0.0.1:${gated.getPort()}`;
      gatedToken = gated.getToken();
    });

    afterEach(() => {
      gated.stop();
    });

    async function gatedPost(body: unknown): Promise<Response> {
      return fetch(`${gatedUrl}/mcp/default`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gatedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    it("tools/list omits tools for which isToolEnabled returns false", async () => {
      enabledSet = new Set(["show_webpage"]); // mermaid + markdown disabled

      const response = await gatedPost({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const parsed = (await response.json()) as any;
      const names = parsed.result.tools.map((t: any) => t.name);
      expect(names).toEqual(["show_webpage"]);
    });

    it("tools/list returns an empty list when all tools are disabled", async () => {
      enabledSet = new Set(); // all disabled

      const response = await gatedPost({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const parsed = (await response.json()) as any;
      expect(parsed.result.tools).toEqual([]);
    });

    it("tools/call refuses a disabled tool with isError and a clear message", async () => {
      enabledSet = new Set(["show_webpage"]); // mermaid disabled

      const response = await gatedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "show_mermaid_diagram",
          arguments: { diagram: "graph LR; A-->B", title: "Flow" },
        },
      });
      const parsed = (await response.json()) as any;
      expect(parsed.result.isError).toBe(true);
      expect(parsed.result.content[0].text).toContain("disabled in Tempest settings");
    });

    it("tools/call still works for an enabled tool when siblings are disabled", async () => {
      enabledSet = new Set(["show_markdown"]);

      const response = await gatedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "show_markdown",
          arguments: { markdown: "# ok", title: "Notes" },
        },
      });
      const parsed = (await response.json()) as any;
      expect(parsed.result.isError).toBeFalsy();
    });
  });
});
