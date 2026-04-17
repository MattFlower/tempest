// ============================================================
// JJRebaseDialog — modal dialog for rebasing a revision onto
// a destination (change-id or bookmark name).
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import type { JJRevision, JJBookmark } from "../../../../shared/ipc-types";

interface JJRebaseDialogProps {
  changeId: string;
  revisions: JJRevision[];
  bookmarks: JJBookmark[];
  onConfirm: (destination: string) => void;
  onCancel: () => void;
}

export function JJRebaseDialog({
  changeId,
  revisions,
  bookmarks,
  onConfirm,
  onCancel,
}: JJRebaseDialogProps) {
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = destination.trim();
    if (!trimmed) {
      setError("Destination is required");
      return;
    }
    if (trimmed === changeId) {
      setError("Cannot rebase onto itself");
      return;
    }
    onConfirm(trimmed);
  }, [destination, changeId, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Build quick-pick suggestions: bookmarks + recent non-immutable change-ids
  const suggestions: { label: string; value: string; type: "bookmark" | "change" }[] = [];
  for (const bm of bookmarks) {
    suggestions.push({ label: bm.name, value: bm.name, type: "bookmark" });
  }
  for (const rev of revisions) {
    if (rev.changeId === changeId) continue;
    if (suggestions.length >= 12) break;
    suggestions.push({
      label: `${rev.changeId} ${rev.description || "(no description)"}`,
      value: rev.changeId,
      type: "change",
    });
  }

  const filteredSuggestions = destination.trim()
    ? suggestions.filter(
        (s) =>
          s.label.toLowerCase().includes(destination.toLowerCase()) ||
          s.value.toLowerCase().includes(destination.toLowerCase()),
      )
    : suggestions;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="rounded-xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface1)",
          width: 400,
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3"
          style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
        >
          <div className="text-sm font-medium" style={{ color: "var(--ctp-text)" }}>
            Rebase Onto
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--ctp-overlay0)" }}>
            Rebase{" "}
            <span className="font-mono font-bold" style={{ color: "var(--ctp-mauve)" }}>
              {changeId}
            </span>{" "}
            onto a new destination
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex flex-col gap-2">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            Destination (change-id or bookmark)
          </label>
          <input
            ref={inputRef}
            type="text"
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. main, xqvmlskk, trunk()"
            className="w-full text-xs px-2.5 py-1.5 rounded outline-none font-mono"
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

          {/* Quick-pick suggestions */}
          {filteredSuggestions.length > 0 && (
            <div
              className="rounded overflow-hidden max-h-40 overflow-y-auto mt-1"
              style={{
                border: "1px solid var(--ctp-surface0)",
                backgroundColor: "var(--ctp-mantle)",
              }}
            >
              {filteredSuggestions.map((s) => (
                <button
                  key={s.value}
                  className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: "var(--ctp-text)" }}
                  onClick={() => {
                    setDestination(s.value);
                    setError(null);
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.backgroundColor =
                      "var(--ctp-surface0)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.backgroundColor =
                      "transparent")
                  }
                >
                  <span
                    className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                    style={{
                      backgroundColor:
                        s.type === "bookmark"
                          ? "var(--ctp-green)"
                          : "var(--ctp-surface1)",
                      color:
                        s.type === "bookmark"
                          ? "var(--ctp-base)"
                          : "var(--ctp-overlay1)",
                    }}
                  >
                    {s.type === "bookmark" ? "bookmark" : "change"}
                  </span>
                  <span className="truncate font-mono">{s.label}</span>
                </button>
              ))}
            </div>
          )}
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
            Rebase
          </button>
        </div>
      </div>
    </div>
  );
}
