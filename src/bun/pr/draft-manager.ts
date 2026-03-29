// ============================================================
// DraftManager — In-memory store for PR draft replies.
// Port of DraftManager.swift.
// ============================================================

import type { PRDraft, DraftPostBody, PRComment } from "./pr-models";

export class DraftManager {
  private drafts: PRDraft[] = [];

  /** Callback when drafts change — used to notify webview. */
  onDraftsChanged: (() => void) | null = null;

  addDraft(
    body: DraftPostBody,
    workspacePath: string,
    storedComments: Map<string, PRComment>,
  ): PRDraft {
    // Skip if a draft already exists for this comment in this workspace
    const existing = this.drafts.find(
      (d) => d.workspacePath === workspacePath && d.nodeId === body.node_id,
    );
    if (existing) return existing;

    const stored = storedComments.get(body.node_id);

    const draft: PRDraft = {
      id: crypto.randomUUID(),
      workspacePath,
      nodeId: body.node_id,
      replyText: body.reply_text,
      hasCodeChange: body.has_code_change,
      commitDescription: body.commit_description ?? undefined,
      commitRef: body.commit_ref ?? undefined,
      createdAt: new Date().toISOString(),
      status: "pending",
      originalAuthor: stored?.author,
      originalBody: stored?.body,
      originalPath: stored?.path,
      originalLine: stored?.line,
    };

    this.drafts.push(draft);
    this.onDraftsChanged?.();
    return draft;
  }

  getDrafts(workspacePath: string): PRDraft[] {
    return this.drafts.filter((d) => d.workspacePath === workspacePath);
  }

  getPendingDrafts(workspacePath: string): PRDraft[] {
    return this.drafts.filter(
      (d) => d.workspacePath === workspacePath && d.status === "pending",
    );
  }

  getDraftById(id: string): PRDraft | undefined {
    return this.drafts.find((d) => d.id === id);
  }

  approveDraft(id: string): PRDraft | undefined {
    const draft = this.drafts.find((d) => d.id === id);
    if (draft) {
      draft.status = "approved";
      this.onDraftsChanged?.();
    }
    return draft;
  }

  markSent(id: string): PRDraft | undefined {
    const draft = this.drafts.find((d) => d.id === id);
    if (draft) {
      draft.status = "sent";
      this.onDraftsChanged?.();
    }
    return draft;
  }

  markFailed(id: string, message: string): PRDraft | undefined {
    const draft = this.drafts.find((d) => d.id === id);
    if (draft) {
      draft.status = "failed";
      draft.failureMessage = message;
      this.onDraftsChanged?.();
    }
    return draft;
  }

  updateDraftText(id: string, text: string): PRDraft | undefined {
    const draft = this.drafts.find((d) => d.id === id);
    if (draft) {
      draft.replyText = text;
      this.onDraftsChanged?.();
    }
    return draft;
  }

  dismissDraft(id: string): void {
    const idx = this.drafts.findIndex((d) => d.id === id);
    if (idx !== -1) {
      this.drafts.splice(idx, 1);
      this.onDraftsChanged?.();
    }
  }

  clear(workspacePath: string): void {
    this.drafts = this.drafts.filter((d) => d.workspacePath !== workspacePath);
    this.onDraftsChanged?.();
  }
}
