// ============================================================
// GitCommitPicker — dropdown for selecting a commit to view.
// Shows currently selected commit; click opens scrollable list.
// ============================================================

import { useState, useRef, useEffect } from "react";
import type { GitCommitEntry } from "../../../../shared/ipc-types";

interface GitCommitPickerProps {
  commits: GitCommitEntry[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  isLoading?: boolean;
}

export function GitCommitPicker({
  commits,
  selectedHash,
  onSelect,
  isLoading,
}: GitCommitPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const selectedCommit = commits.find((c) => c.hash === selectedHash || c.fullHash === selectedHash);

  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 relative"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      {/* Current selection / trigger */}
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:opacity-80 transition-opacity"
        onClick={() => setIsOpen(!isOpen)}
        style={{ color: "var(--ctp-text)" }}
      >
        {isLoading ? (
          <span style={{ color: "var(--ctp-overlay0)" }}>Loading commits...</span>
        ) : selectedCommit ? (
          <>
            <span className="font-mono flex-shrink-0" style={{ color: "var(--ctp-mauve)" }}>
              {selectedCommit.hash}
            </span>
            <span className="truncate">{selectedCommit.message}</span>
            <span
              className="ml-auto flex-shrink-0"
              style={{ color: "var(--ctp-overlay0)", fontSize: 10 }}
            >
              {selectedCommit.date}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ctp-overlay0)" }}>Select a commit...</span>
        )}
        <span className="ml-auto flex-shrink-0" style={{ color: "var(--ctp-overlay0)" }}>
          {isOpen ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {/* Dropdown list */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 z-50 overflow-y-auto"
          style={{
            backgroundColor: "var(--ctp-base)",
            border: "1px solid var(--ctp-surface1)",
            borderTop: "none",
            maxHeight: 300,
          }}
        >
          {commits.map((commit) => {
            const isSelected = commit.hash === selectedHash || commit.fullHash === selectedHash;
            return (
              <button
                key={commit.fullHash}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left transition-colors"
                style={{
                  backgroundColor: isSelected ? "var(--ctp-surface0)" : "transparent",
                  color: "var(--ctp-text)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--ctp-surface0)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
                onClick={() => {
                  onSelect(commit.hash);
                  setIsOpen(false);
                }}
              >
                <span className="font-mono flex-shrink-0" style={{ color: "var(--ctp-mauve)" }}>
                  {commit.hash}
                </span>
                <span className="truncate">{commit.message}</span>
                <span
                  className="ml-auto flex-shrink-0"
                  style={{ color: "var(--ctp-overlay0)", fontSize: 10 }}
                >
                  {commit.date}
                </span>
              </button>
            );
          })}
          {commits.length === 0 && (
            <div className="px-2 py-3 text-xs text-center" style={{ color: "var(--ctp-overlay0)" }}>
              No commits found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
