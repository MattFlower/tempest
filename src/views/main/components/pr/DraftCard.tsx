// ============================================================
// DraftCard — Individual PR draft reply card.
// Port of DraftCardView.swift.
// Shows original comment context, Claude's draft reply,
// and approve/dismiss actions.
// ============================================================

import { useState, useCallback } from "react";
import type { PRDraftSummary } from "../../../../shared/ipc-types";

interface DraftCardProps {
  draft: PRDraftSummary;
  onApprove: (id: string) => void;
  onDismiss: (id: string, abandon: boolean) => void;
}

export function DraftCard({ draft, onApprove, onDismiss }: DraftCardProps) {
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [approving, setApproving] = useState(false);

  const isPending = draft.status === "pending";

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
              {draft.originalPath}
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
        <div
          className="text-sm whitespace-pre-wrap rounded px-2 py-1.5"
          style={{
            color: "var(--ctp-text)",
            backgroundColor: "var(--ctp-mantle)",
          }}
        >
          {draft.replyText}
        </div>
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
            className="text-xs"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {draft.commitDescription || ""}
          </span>
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

      {/* Actions (only for pending) */}
      {isPending && (
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
                  {approving ? "Posting..." : "Approve"}
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

      {/* Approved/dismissed status */}
      {draft.status === "approved" && (
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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: "PENDING", color: "var(--ctp-peach)" },
    approved: { label: "APPROVED", color: "var(--ctp-green)" },
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
      return "rgba(166, 227, 161, 0.3)"; // green
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
