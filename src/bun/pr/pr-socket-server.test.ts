import { describe, it, expect } from "bun:test";
import { extractWorkspace, formatSSE } from "./pr-socket-server";

describe("PRSocketServer helpers", () => {
  describe("extractWorkspace", () => {
    it("extracts workspace name from /workspace/{name}/events", () => {
      expect(extractWorkspace("/workspace/my-project/events")).toBe(
        "my-project",
      );
    });

    it("extracts workspace name from /workspace/{name}/draft", () => {
      expect(extractWorkspace("/workspace/test-ws/draft")).toBe("test-ws");
    });

    it("extracts workspace name with only two segments", () => {
      expect(extractWorkspace("/workspace/default")).toBe("default");
    });

    it("returns null for paths without workspace prefix", () => {
      expect(extractWorkspace("/api/health")).toBeNull();
    });

    it("returns null for root path", () => {
      expect(extractWorkspace("/")).toBeNull();
    });

    it("returns null for empty path", () => {
      expect(extractWorkspace("")).toBeNull();
    });

    it("returns null for /workspace with no name", () => {
      expect(extractWorkspace("/workspace")).toBeNull();
      expect(extractWorkspace("/workspace/")).toBeNull();
    });
  });

  describe("formatSSE", () => {
    it("formats a simple event", () => {
      const result = formatSSE("new_comment", '{"body":"test"}');
      expect(result).toBe('event: new_comment\ndata: {"body":"test"}\n\n');
    });

    it("ends with double newline", () => {
      const result = formatSSE("ping", "{}");
      expect(result.endsWith("\n\n")).toBe(true);
    });

    it("contains event and data lines", () => {
      const result = formatSSE("type", "payload");
      const lines = result.split("\n");
      expect(lines[0]).toBe("event: type");
      expect(lines[1]).toBe("data: payload");
    });
  });
});
