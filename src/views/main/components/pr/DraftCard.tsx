// ============================================================
// DraftCard — Individual PR draft reply card.
// Port of DraftCardView.swift.
// Shows original comment context, Claude's draft reply,
// and approve/dismiss actions.
// ============================================================

import { useState, useCallback, useEffect } from "react";
import type { PRDraftSummary } from "../../../../shared/ipc-types";

interface DraftCardProps {
  draft: PRDraftSummary;
  onApprove: (id: string) => void;
  onDismiss: (id: string, abandon: boolean) => void;
  onEditReply?: (id: string, text: string) => void;
  onViewDiff?: (commitRef: string) => void;
}

export function DraftCard({ draft, onApprove, onDismiss, onEditReply, onViewDiff }: DraftCardProps) {
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(draft.replyText);

  // Sync editText when draft.replyText changes externally (e.g. after save + refresh)
  useEffect(() => {
    if (!isEditing) setEditText(draft.replyText);
  }, [draft.replyText, isEditing]);

  const isPending = draft.status === "pending";
  const isActionable = draft.status === "pending" || draft.status === "failed";

  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      onApprove(draft.id);
    } finally {
      setApproving(false);
    }
  }, [draft.id, onApprove]);

  const createdAtRelative = formatRelativeTime(draft.createdAt);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg"
      style={{
        backgroundColor: "var(--ctp-surface0)",
        border: `1px solid ${borderColor(draft.status)}`,
      }}
    >
      {/* Header: status + file info */}
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusBadge status={draft.status} />
        {draft.originalAuthor && (
          <span
            className="text-xs"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            @{draft.originalAuthor}
          </span>
        )}
        {draft.originalPath && (
          <>
            <span
              className="text-xs"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              on
            </span>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--ctp-subtext0)" }}
            >
              {draft.originalPath}{draft.originalLine ? `:${draft.originalLine}` : ""}
            </span>
          </>
        )}
        <span className="flex-1" />
        <span
          className="text-xs"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {createdAtRelative}
        </span>
      </div>

      <div
        className="h-px"
        style={{ backgroundColor: "var(--ctp-surface1)" }}
      />

      {/* Original comment */}
      <div
        className="px-3 py-2"
        style={{ backgroundColor: "var(--ctp-mantle)" }}
      >
        <div
          className="text-[10px] font-semibold mb-1"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          REVIEW COMMENT
        </div>
        <div
          className="text-sm whitespace-pre-wrap"
          style={{ color: "var(--ctp-text)" }}
        >
          {draft.originalBody || "(no comment body)"}
        </div>
      </div>

      <div
        className="h-px"
        style={{ backgroundColor: "var(--ctp-surface1)" }}
      />

      {/* Draft reply */}
      <div className="px-3 py-2">
        <div
          className="text-[10px] font-semibold mb-1"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          DRAFT REPLY
        </div>
        {isEditing ? (
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full text-sm rounded px-2 py-1.5 outline-none resize-y"
              style={{
                color: "var(--ctp-text)",
                backgroundColor: "var(--ctp-mantle)",
                border: "1px solid var(--ctp-surface1)",
                minHeight: "60px",
              }}
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  onEditReply?.(draft.id, editText);
                  setIsEditing(false);
                }}
                className="px-2 py-0.5 text-xs font-medium rounded"
                style={{
                  backgroundColor: "var(--ctp-blue)",
                  color: "var(--ctp-base)",
                }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditText(draft.replyText);
                  setIsEditing(false);
                }}
                className="px-2 py-0.5 text-xs font-medium rounded"
                style={{
                  backgroundColor: "var(--ctp-surface1)",
                  color: "var(--ctp-text)",
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div
            className="text-sm whitespace-pre-wrap rounded px-2 py-1.5"
            style={{
              color: "var(--ctp-text)",
              backgroundColor: "var(--ctp-mantle)",
            }}
          >
            {draft.replyText}
          </div>
        )}
      </div>

      {/* Code change indicator */}
      <div
        className="h-px"
        style={{ backgroundColor: "var(--ctp-surface1)" }}
      />
      {draft.hasCodeChange ? (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ backgroundColor: "rgba(166, 227, 161, 0.05)" }}
        >
          <span style={{ color: "var(--ctp-green)" }} className="text-xs">
            {"\u25C6"}
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--ctp-green)" }}
          >
            Code change:
          </span>
          <span
            className="text-xs flex-1"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {draft.commitDescription || ""}
          </span>
          {draft.commitRef && onViewDiff && (
            <button
              onClick={() => onViewDiff(draft.commitRef!)}
              className="px-2 py-0.5 text-xs font-medium rounded"
              style={{
                backgroundColor: "var(--ctp-surface1)",
                color: "var(--ctp-text)",
              }}
            >
              View Diff
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className="text-xs"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Reply only -- no code change
          </span>
        </div>
      )}

      {/* Actions (pending and failed drafts can be retried/edited/dismissed) */}
      {isActionable && (
        <>
          <div
            className="h-px"
            style={{ backgroundColor: "var(--ctp-surface1)" }}
          />
          <div className="flex items-center gap-2 px-3 py-2">
            {!showDismissConfirm ? (
              <>
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--ctp-green)",
                    color: "var(--ctp-base)",
                  }}
                >
                  {approving ? "Posting..." : draft.status === "failed" ? "Retry" : "Approve"}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  Edit Reply
                </button>
                <button
                  onClick={() => setShowDismissConfirm(true)}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <span
                  className="text-xs"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  Abandon code changes too?
                </span>
                <button
                  onClick={() => {
                    onDismiss(draft.id, true);
                    setShowDismissConfirm(false);
                  }}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--ctp-red)",
                    color: "var(--ctp-base)",
                  }}
                >
                  Dismiss & Abandon
                </button>
                <button
                  onClick={() => {
                    onDismiss(draft.id, false);
                    setShowDismissConfirm(false);
                  }}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    backgroundColor: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  Dismiss & Keep
                </button>
                <button
                  onClick={() => setShowDismissConfirm(false)}
                  className="px-3 py-1 text-xs font-medium rounded"
                  style={{
                    color: "var(--ctp-overlay0)",
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Sent status */}
      {draft.status === "sent" && (
        <>
          <div
            className="h-px"
            style={{ backgroundColor: "var(--ctp-surface1)" }}
          />
          <div className="px-3 py-2">
            <span
              className="text-xs"
              style={{ color: "var(--ctp-green)" }}
            >
              Reply posted to GitHub
            </span>
          </div>
        </>
      )}

      {/* Failed status */}
      {draft.status === "failed" && (
        <>
          <div
            className="h-px"
            style={{ backgroundColor: "var(--ctp-surface1)" }}
          />
          <div
            className="px-3 py-2"
            style={{ backgroundColor: "rgba(243, 139, 168, 0.05)" }}
          >
            <span
              className="text-xs font-mono"
              style={{ color: "var(--ctp-red)" }}
            >
              {draft.failureMessage || "Failed to post reply"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: "PENDING", color: "var(--ctp-peach)" },
    approved: { label: "APPROVED", color: "var(--ctp-blue)" },
    sent: { label: "SENT", color: "var(--ctp-green)" },
    failed: { label: "FAILED", color: "var(--ctp-red)" },
    dismissed: { label: "DISMISSED", color: "var(--ctp-overlay0)" },
  };

  const { label, color } = config[status] ?? {
    label: status.toUpperCase(),
    color: "var(--ctp-overlay0)",
  };

  return (
    <span
      className="text-[10px] font-bold"
      style={{ color }}
    >
      {"\u25CF"} {label}
    </span>
  );
}

function borderColor(status: string): string {
  switch (status) {
    case "pending":
      return "rgba(250, 179, 135, 0.3)"; // peach
    case "approved":
      return "rgba(137, 180, 250, 0.3)"; // blue
    case "sent":
      return "rgba(166, 227, 161, 0.3)"; // green
    case "failed":
      return "rgba(243, 139, 168, 0.3)"; // red
    default:
      return "var(--ctp-surface1)";
  }
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
