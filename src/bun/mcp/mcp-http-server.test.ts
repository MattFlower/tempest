import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { McpHttpServer } from "./mcp-http-server";

describe("McpHttpServer", () => {
  let server: McpHttpServer;
  let baseUrl: string;
  let token: string;

  beforeEach(() => {
    server = new McpHttpServer();
    server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;
    token = server.getToken();
  });

  afterEach(() => {
    server.stop();
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
});
