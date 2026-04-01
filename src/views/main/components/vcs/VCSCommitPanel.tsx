// ============================================================
// VCSCommitPanel — commit message textarea + action buttons.
// Supports amend, commit, and commit-and-push.
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";

interface VCSCommitPanelProps {
  branch: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  onCommit: (message: string, amend: boolean) => Promise<void>;
  onCommitAndPush: (message: string, amend: boolean) => Promise<void>;
  isCommitting: boolean;
}

export function VCSCommitPanel({
  branch,
  ahead,
  behind,
  stagedCount,
  onCommit,
  onCommitAndPush,
  isCommitting,
}: VCSCommitPanelProps) {
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [message]);

  const handleCommit = useCallback(() => {
    if (!message.trim() && !amend) return;
    onCommit(message, amend);
  }, [message, amend, onCommit]);

  const handleCommitAndPush = useCallback(() => {
    if (!message.trim() && !amend) return;
    onCommitAndPush(message, amend);
  }, [message, amend, onCommitAndPush]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+Enter to commit
      if (e.metaKey && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
      // Cmd+Shift+Enter to commit and push
      if (e.metaKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        handleCommitAndPush();
      }
    },
    [handleCommit, handleCommitAndPush],
  );

  const canCommit = (message.trim().length > 0 || amend) && stagedCount > 0 && !isCommitting;

  return (
    <div
      className="flex flex-col gap-2 p-3 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderTop: "1px solid var(--ctp-surface0)",
      }}
    >
      {/* Branch info */}
      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: "var(--ctp-mauve)" }}>{branch || "detached"}</span>
        {(ahead > 0 || behind > 0) && (
          <span style={{ color: "var(--ctp-overlay0)" }}>
            {ahead > 0 && `+${ahead}`}
            {ahead > 0 && behind > 0 && " / "}
            {behind > 0 && `-${behind}`}
          </span>
        )}
      </div>

      {/* Commit message textarea */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        className="w-full text-xs rounded px-2 py-1.5 resize-none outline-none"
        style={{
          backgroundColor: "var(--ctp-base)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
          minHeight: 60,
          maxHeight: 200,
        }}
        rows={3}
      />

      {/* Options and buttons */}
      <div className="flex items-center gap-2">
        {/* Amend checkbox */}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
            className="accent-[var(--ctp-mauve)]"
            style={{ width: 13, height: 13 }}
          />
          <span style={{ color: "var(--ctp-subtext0)" }}>Amend</span>
        </label>

        <div className="flex-1" />

        {/* Commit button */}
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
          style={{
            backgroundColor: canCommit ? "var(--ctp-mauve)" : "var(--ctp-surface0)",
            color: canCommit ? "var(--ctp-base)" : "var(--ctp-overlay0)",
            cursor: canCommit ? "pointer" : "default",
            opacity: canCommit ? 1 : 0.6,
          }}
          title="Commit (Cmd+Enter)"
        >
          {isCommitting ? "Committing..." : "Commit"}
        </button>

        {/* Commit and Push button */}
        <button
          onClick={handleCommitAndPush}
          disabled={!canCommit}
          className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
          style={{
            backgroundColor: canCommit ? "var(--ctp-blue)" : "var(--ctp-surface0)",
            color: canCommit ? "var(--ctp-base)" : "var(--ctp-overlay0)",
            cursor: canCommit ? "pointer" : "default",
            opacity: canCommit ? 1 : 0.6,
          }}
          title="Commit and Push (Cmd+Shift+Enter)"
        >
          {isCommitting ? "..." : "Commit & Push"}
        </button>
      </div>
    </div>
  );
}
