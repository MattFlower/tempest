import { describe, it, expect } from "bun:test";
import { PRPoller } from "./pr-poller";
import type { GitHubReviewComment } from "./pr-models";

describe("PRPoller", () => {
  describe("parseComments", () => {
    it("parses a valid JSON array of comments", () => {
      const json = JSON.stringify([
        {
          id: 1,
          node_id: "IC_abc",
          user: { login: "reviewer1" },
          body: "Please fix this",
          path: "src/main.ts",
          line: 42,
          diff_hunk: "@@ -1,3 +1,5 @@",
          created_at: "2026-01-15T10:00:00Z",
          html_url: "https://github.com/owner/repo/pull/1/comments/1",
        },
      ]);
      const comments = PRPoller.parseComments(json);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.node_id).toBe("IC_abc");
      expect(comments[0]!.user.login).toBe("reviewer1");
      expect(comments[0]!.body).toBe("Please fix this");
      expect(comments[0]!.path).toBe("src/main.ts");
      expect(comments[0]!.line).toBe(42);
    });

    it("returns empty array for invalid JSON", () => {
      expect(PRPoller.parseComments("not json")).toEqual([]);
    });

    it("returns empty array for JSON object (not array)", () => {
      expect(PRPoller.parseComments('{"key": "value"}')).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(PRPoller.parseComments("")).toEqual([]);
    });

    it("parses empty array", () => {
      expect(PRPoller.parseComments("[]")).toEqual([]);
    });
  });

  describe("filterNew", () => {
    const makeComment = (
      nodeId: string,
      login: string,
    ): GitHubReviewComment => ({
      id: Math.random(),
      node_id: nodeId,
      user: { login },
      body: "some comment",
      created_at: "2026-01-15T10:00:00Z",
      html_url: "https://github.com/owner/repo/pull/1/comments/1",
    });

    it("filters out already-seen comments", () => {
      const comments = [makeComment("A", "reviewer"), makeComment("B", "reviewer")];
      const seen = new Set(["A"]);
      const result = PRPoller.filterNew(comments, seen, "me");
      expect(result).toHaveLength(1);
      expect(result[0]!.node_id).toBe("B");
    });

    it("filters out comments from the current user", () => {
      const comments = [makeComment("A", "me"), makeComment("B", "reviewer")];
      const seen = new Set<string>();
      const result = PRPoller.filterNew(comments, seen, "me");
      expect(result).toHaveLength(1);
      expect(result[0]!.node_id).toBe("B");
    });

    it("filters out resolved comments", () => {
      const comments = [makeComment("A", "reviewer"), makeComment("B", "reviewer")];
      const seen = new Set<string>();
      const resolved = new Set(["A"]);
      const result = PRPoller.filterNew(comments, seen, "me", resolved);
      expect(result).toHaveLength(1);
      expect(result[0]!.node_id).toBe("B");
    });

    it("applies all filters simultaneously", () => {
      const comments = [
        makeComment("seen", "reviewer"),
        makeComment("mine", "me"),
        makeComment("resolved", "reviewer"),
        makeComment("new", "reviewer"),
      ];
      const seen = new Set(["seen"]);
      const resolved = new Set(["resolved"]);
      const result = PRPoller.filterNew(comments, seen, "me", resolved);
      expect(result).toHaveLength(1);
      expect(result[0]!.node_id).toBe("new");
    });

    it("returns empty array when all filtered", () => {
      const comments = [makeComment("A", "me")];
      const result = PRPoller.filterNew(comments, new Set(), "me");
      expect(result).toHaveLength(0);
    });
  });

  describe("toStoredComment", () => {
    it("maps GitHubReviewComment to PRComment", () => {
      const ghComment: GitHubReviewComment = {
        id: 42,
        node_id: "IC_xyz",
        user: { login: "alice" },
        body: "Looks good",
        path: "src/foo.ts",
        line: 10,
        diff_hunk: "@@ -5,3 +5,5 @@",
        created_at: "2026-03-01T12:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1/comments/42",
      };

      const stored = PRPoller.toStoredComment(ghComment);
      expect(stored.nodeId).toBe("IC_xyz");
      expect(stored.author).toBe("alice");
      expect(stored.body).toBe("Looks good");
      expect(stored.path).toBe("src/foo.ts");
      expect(stored.line).toBe(10);
      expect(stored.diffHunk).toBe("@@ -5,3 +5,5 @@");
      expect(stored.createdAt).toBe("2026-03-01T12:00:00Z");
      expect(stored.url).toBe(
        "https://github.com/owner/repo/pull/1/comments/42",
      );
    });

    it("handles missing optional fields", () => {
      const ghComment: GitHubReviewComment = {
        id: 1,
        node_id: "IC_a",
        user: { login: "bob" },
        body: "test",
        created_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1/comments/1",
      };

      const stored = PRPoller.toStoredComment(ghComment);
      expect(stored.path).toBeUndefined();
      expect(stored.line).toBeUndefined();
      expect(stored.diffHunk).toBeUndefined();
    });
  });

  describe("parseResolvedNodeIds", () => {
    it("extracts node IDs from resolved threads", () => {
      const response = {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    isResolved: true,
                    comments: { nodes: [{ id: "R1" }] },
                  },
                  {
                    isResolved: false,
                    comments: { nodes: [{ id: "R2" }] },
                  },
                  {
                    isResolved: true,
                    comments: { nodes: [{ id: "R3" }] },
                  },
                ],
              },
            },
          },
        },
      };

      const ids = PRPoller.parseResolvedNodeIds(JSON.stringify(response));
      expect(ids.size).toBe(2);
      expect(ids.has("R1")).toBe(true);
      expect(ids.has("R3")).toBe(true);
      expect(ids.has("R2")).toBe(false);
    });

    it("returns empty set for invalid JSON", () => {
      const ids = PRPoller.parseResolvedNodeIds("not json");
      expect(ids.size).toBe(0);
    });

    it("returns empty set for empty threads", () => {
      const response = {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: [] },
            },
          },
        },
      };
      const ids = PRPoller.parseResolvedNodeIds(JSON.stringify(response));
      expect(ids.size).toBe(0);
    });
  });
});
