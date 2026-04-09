import { useState } from "react";
import type { VCSFileEntry } from "../../../../shared/ipc-types";
import { useOverlay } from "../../state/useOverlay";
import { api } from "../../state/rpc-client";

interface Props {
  workspacePath: string;
  files: VCSFileEntry[];
  onCommitted: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

function changeTypeLabel(changeType: string): string {
  switch (changeType) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "untracked": return "?";
    default: return "?";
  }
}

function changeTypeColor(changeType: string): string {
  switch (changeType) {
    case "modified": return "var(--ctp-yellow)";
    case "added":
    case "untracked": return "var(--ctp-green)";
    case "deleted": return "var(--ctp-red)";
    case "renamed":
    case "copied": return "var(--ctp-blue)";
    default: return "var(--ctp-text)";
  }
}

export function UncommittedChangesDialog({ workspacePath, files, onCommitted, onSkip, onCancel }: Props) {
  useOverlay();

  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const handleCommit = async () => {
    const msg = commitMessage.trim();
    if (!msg) return;
    setIsCommitting(true);
    setErrorMessage(null);

    try {
      // Stage all unstaged changes
      if (unstagedFiles.length > 0) {
        await api.vcsStageAll(workspacePath);
      }
      // Commit
      const result = await api.vcsCommit(workspacePath, msg, false);
      if (!result.success) {
        setErrorMessage(result.error ?? "Commit failed.");
        setIsCommitting(false);
        return;
      }
      onCommitted();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setIsCommitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onCancel}
    >
      <div
        className="flex flex-col gap-3 rounded-xl p-5 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 500,
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="text-center">
          <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
            Uncommitted Changes
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            You have uncommitted changes. Would you like to commit before opening a PR?
          </p>
        </div>

        {/* File list */}
        <div
          className="flex flex-col gap-0.5 overflow-y-auto rounded px-2 py-1.5"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            border: "1px solid var(--ctp-surface0)",
            maxHeight: 200,
          }}
        >
          {stagedFiles.length > 0 && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider py-1" style={{ color: "var(--ctp-overlay0)" }}>
                Staged
              </div>
              {stagedFiles.map((f) => (
                <FileRow key={`staged-${f.path}`} file={f} />
              ))}
            </>
          )}
          {unstagedFiles.length > 0 && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider py-1" style={{ color: "var(--ctp-overlay0)" }}>
                {unstagedFiles.some((f) => f.changeType === "untracked") && stagedFiles.length === 0 && unstagedFiles.every((f) => f.changeType === "untracked")
                  ? "Untracked"
                  : "Unstaged"}
              </div>
              {unstagedFiles.map((f) => (
                <FileRow key={`unstaged-${f.path}`} file={f} />
              ))}
            </>
          )}
        </div>

        {/* Commit message */}
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            Commit message
          </label>
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && commitMessage.trim()) {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder="Enter commit message..."
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
            autoFocus
            disabled={isCommitting}
          />
        </div>

        {errorMessage && (
          <p className="text-[11px]" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        {isCommitting && (
          <p className="text-[11px] text-center" style={{ color: "var(--ctp-overlay0)" }}>
            Committing changes...
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)" }}
            disabled={isCommitting}
          >
            Cancel
          </button>
          <button
            onClick={onSkip}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{
              backgroundColor: "var(--ctp-surface1)",
              color: "var(--ctp-text)",
            }}
            disabled={isCommitting}
          >
            Continue Without Committing
          </button>
          <button
            onClick={handleCommit}
            disabled={!commitMessage.trim() || isCommitting}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: commitMessage.trim() && !isCommitting ? "var(--ctp-green)" : "var(--ctp-surface1)",
              color: commitMessage.trim() && !isCommitting ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: commitMessage.trim() && !isCommitting ? 1 : 0.5,
              cursor: commitMessage.trim() && !isCommitting ? "pointer" : "not-allowed",
            }}
          >
            Commit & Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function FileRow({ file }: { file: VCSFileEntry }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs font-mono">
      <span
        className="w-3 text-center font-bold"
        style={{ color: changeTypeColor(file.changeType) }}
      >
        {changeTypeLabel(file.changeType)}
      </span>
      <span style={{ color: "var(--ctp-text)" }}>{file.path}</span>
    </div>
  );
}
