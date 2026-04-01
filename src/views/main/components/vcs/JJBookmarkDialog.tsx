// ============================================================
// JJBookmarkDialog — modal dialog for setting a bookmark on a revision.
// Gathers bookmark name and whether to track changes.
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";

interface JJBookmarkDialogProps {
  changeId: string;
  existingBookmarks: string[];
  onConfirm: (name: string, track: boolean) => void;
  onCancel: () => void;
}

export function JJBookmarkDialog({
  changeId,
  existingBookmarks,
  onConfirm,
  onCancel,
}: JJBookmarkDialogProps) {
  const [name, setName] = useState("");
  const [track, setTrack] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Bookmark name is required");
      return;
    }
    // Validate: no spaces, no special chars that jj wouldn't allow
    if (/\s/.test(trimmed)) {
      setError("Bookmark name cannot contain spaces");
      return;
    }
    onConfirm(trimmed, track);
  }, [name, track, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isExisting = existingBookmarks.includes(name.trim());

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Dialog */}
      <div
        className="rounded-xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface1)",
          width: 360,
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3"
          style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
        >
          <div className="text-sm font-medium" style={{ color: "var(--ctp-text)" }}>
            Set Bookmark
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--ctp-overlay0)" }}>
            on revision{" "}
            <span className="font-mono font-bold" style={{ color: "var(--ctp-mauve)" }}>
              {changeId}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Bookmark name */}
          <div className="flex flex-col gap-1">
            <label
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              Bookmark Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. my-feature"
              className="w-full text-xs px-2.5 py-1.5 rounded outline-none"
              style={{
                backgroundColor: "var(--ctp-mantle)",
                color: "var(--ctp-text)",
                border: `1px solid ${error ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
              }}
            />
            {error && (
              <span className="text-[10px]" style={{ color: "var(--ctp-red)" }}>
                {error}
              </span>
            )}
            {isExisting && !error && (
              <span className="text-[10px]" style={{ color: "var(--ctp-yellow)" }}>
                This will move the existing bookmark to this revision
              </span>
            )}
          </div>

          {/* Track checkbox */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={track}
              onChange={(e) => setTrack(e.target.checked)}
              className="accent-[var(--ctp-mauve)]"
              style={{ width: 14, height: 14 }}
            />
            <div className="flex flex-col">
              <span className="text-xs" style={{ color: "var(--ctp-text)" }}>
                Track changes
              </span>
              <span className="text-[10px]" style={{ color: "var(--ctp-overlay0)" }}>
                Track this bookmark on origin for push/pull
              </span>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--ctp-surface0)" }}
        >
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-xs font-medium rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--ctp-mauve)",
              color: "var(--ctp-base)",
            }}
          >
            Set Bookmark
          </button>
        </div>
      </div>
    </div>
  );
}
