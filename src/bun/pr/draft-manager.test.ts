import { describe, it, expect } from "bun:test";
import { DraftManager } from "./draft-manager";
import type { DraftPostBody, PRComment } from "./pr-models";

function makePostBody(overrides: Partial<DraftPostBody> = {}): DraftPostBody {
  return {
    node_id: "IC_test",
    reply_text: "Thanks for the feedback!",
    has_code_change: false,
    commit_description: null,
    commit_ref: null,
    ...overrides,
  };
}

function makeStoredComments(
  entries: Array<{ nodeId: string; author: string; body: string }>,
): Map<string, PRComment> {
  const map = new Map<string, PRComment>();
  for (const e of entries) {
    map.set(e.nodeId, {
      nodeId: e.nodeId,
      commentId: 1,
      author: e.author,
      body: e.body,
      createdAt: "2026-01-01T00:00:00Z",
      url: `https://github.com/owner/repo/pull/1/comments/1`,
    });
  }
  return map;
}

describe("DraftManager", () => {
  describe("addDraft", () => {
    it("adds a draft and returns it", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([
        { nodeId: "IC_1", author: "reviewer", body: "Fix this" },
      ]);

      const draft = mgr.addDraft(
        makePostBody({ node_id: "IC_1" }),
        "/workspace/test",
        stored,
      );

      expect(draft.id).toBeTruthy();
      expect(draft.nodeId).toBe("IC_1");
      expect(draft.replyText).toBe("Thanks for the feedback!");
      expect(draft.status).toBe("pending");
      expect(draft.workspacePath).toBe("/workspace/test");
      expect(draft.originalAuthor).toBe("reviewer");
      expect(draft.originalBody).toBe("Fix this");
    });

    it("skips duplicate drafts for same workspace + nodeId", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const body = makePostBody({ node_id: "IC_dup" });

      const d1 = mgr.addDraft(body, "/workspace/a", stored);
      const d2 = mgr.addDraft(body, "/workspace/a", stored);

      // Should return the existing one
      expect(d1.id).toBe(d2.id);
      expect(mgr.getDrafts("/workspace/a")).toHaveLength(1);
    });

    it("allows same nodeId in different workspaces", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const body = makePostBody({ node_id: "IC_same" });

      mgr.addDraft(body, "/workspace/a", stored);
      mgr.addDraft(body, "/workspace/b", stored);

      expect(mgr.getDrafts("/workspace/a")).toHaveLength(1);
      expect(mgr.getDrafts("/workspace/b")).toHaveLength(1);
    });

    it("populates code change fields", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const body = makePostBody({
        node_id: "IC_code",
        has_code_change: true,
        commit_description: "Fixed the bug",
        commit_ref: "abc123",
      });

      const draft = mgr.addDraft(body, "/workspace/test", stored);
      expect(draft.hasCodeChange).toBe(true);
      expect(draft.commitDescription).toBe("Fixed the bug");
      expect(draft.commitRef).toBe("abc123");
    });
  });

  describe("getDrafts", () => {
    it("returns only drafts for the requested workspace", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);

      mgr.addDraft(makePostBody({ node_id: "IC_1" }), "/workspace/a", stored);
      mgr.addDraft(makePostBody({ node_id: "IC_2" }), "/workspace/b", stored);
      mgr.addDraft(makePostBody({ node_id: "IC_3" }), "/workspace/a", stored);

      const draftsA = mgr.getDrafts("/workspace/a");
      expect(draftsA).toHaveLength(2);

      const draftsB = mgr.getDrafts("/workspace/b");
      expect(draftsB).toHaveLength(1);
    });

    it("returns empty array for unknown workspace", () => {
      const mgr = new DraftManager();
      expect(mgr.getDrafts("/workspace/unknown")).toEqual([]);
    });
  });

  describe("getPendingDrafts", () => {
    it("returns only pending drafts", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);

      mgr.addDraft(makePostBody({ node_id: "IC_1" }), "/workspace/a", stored);
      const d2 = mgr.addDraft(makePostBody({ node_id: "IC_2" }), "/workspace/a", stored);
      mgr.approveDraft(d2.id);

      const pending = mgr.getPendingDrafts("/workspace/a");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.nodeId).toBe("IC_1");
    });
  });

  describe("approveDraft", () => {
    it("sets status to approved", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const draft = mgr.addDraft(makePostBody(), "/workspace/a", stored);

      const approved = mgr.approveDraft(draft.id);
      expect(approved).toBeTruthy();
      expect(approved!.status).toBe("approved");
    });

    it("returns undefined for unknown id", () => {
      const mgr = new DraftManager();
      expect(mgr.approveDraft("nonexistent")).toBeUndefined();
    });
  });

  describe("dismissDraft", () => {
    it("removes the draft from the list", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const draft = mgr.addDraft(makePostBody(), "/workspace/a", stored);

      mgr.dismissDraft(draft.id);
      expect(mgr.getDrafts("/workspace/a")).toHaveLength(0);
    });

    it("does nothing for unknown id", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      mgr.addDraft(makePostBody(), "/workspace/a", stored);

      mgr.dismissDraft("nonexistent");
      expect(mgr.getDrafts("/workspace/a")).toHaveLength(1);
    });
  });

  describe("getDraftById", () => {
    it("returns the draft by id", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const draft = mgr.addDraft(makePostBody(), "/workspace/a", stored);

      const found = mgr.getDraftById(draft.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(draft.id);
    });

    it("returns undefined for unknown id", () => {
      const mgr = new DraftManager();
      expect(mgr.getDraftById("nonexistent")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all drafts for a workspace", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);

      mgr.addDraft(makePostBody({ node_id: "IC_1" }), "/workspace/a", stored);
      mgr.addDraft(makePostBody({ node_id: "IC_2" }), "/workspace/a", stored);
      mgr.addDraft(makePostBody({ node_id: "IC_3" }), "/workspace/b", stored);

      mgr.clear("/workspace/a");

      expect(mgr.getDrafts("/workspace/a")).toHaveLength(0);
      expect(mgr.getDrafts("/workspace/b")).toHaveLength(1);
    });
  });

  describe("onDraftsChanged callback", () => {
    it("fires on addDraft", () => {
      const mgr = new DraftManager();
      let called = false;
      mgr.onDraftsChanged = () => { called = true; };

      mgr.addDraft(makePostBody(), "/workspace/a", makeStoredComments([]));
      expect(called).toBe(true);
    });

    it("fires on approveDraft", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const draft = mgr.addDraft(makePostBody(), "/workspace/a", stored);

      let called = false;
      mgr.onDraftsChanged = () => { called = true; };
      mgr.approveDraft(draft.id);
      expect(called).toBe(true);
    });

    it("fires on dismissDraft", () => {
      const mgr = new DraftManager();
      const stored = makeStoredComments([]);
      const draft = mgr.addDraft(makePostBody(), "/workspace/a", stored);

      let called = false;
      mgr.onDraftsChanged = () => { called = true; };
      mgr.dismissDraft(draft.id);
      expect(called).toBe(true);
    });

    it("fires on clear", () => {
      const mgr = new DraftManager();
      mgr.addDraft(makePostBody(), "/workspace/a", makeStoredComments([]));

      let called = false;
      mgr.onDraftsChanged = () => { called = true; };
      mgr.clear("/workspace/a");
      expect(called).toBe(true);
    });
  });
});
