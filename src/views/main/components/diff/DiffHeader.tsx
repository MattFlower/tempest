// ============================================================
// DiffHeader — port of DiffHeaderView.swift
// Shows file name, line counts, mode toggle, hunk navigation.
// ============================================================

interface DiffHeaderProps {
  filePath: string;
  addedLines: number;
  deletedLines: number;
  hunkIndex: number;
  totalHunks: number;
  displayMode: "unified" | "side-by-side";
  onDisplayModeChange: (mode: "unified" | "side-by-side") => void;
  onPreviousHunk: () => void;
  onNextHunk: () => void;
}

export function DiffHeader({
  filePath,
  addedLines,
  deletedLines,
  hunkIndex,
  totalHunks,
  displayMode,
  onDisplayModeChange,
  onPreviousHunk,
  onNextHunk,
}: DiffHeaderProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
      style={{
        background: "var(--ctp-surface0)",
        borderBottom: "1px solid var(--ctp-overlay0)",
      }}
    >
      {/* File path */}
      <span
        className="font-mono text-sm truncate"
        style={{ color: "var(--ctp-text)" }}
        title={filePath}
      >
        {filePath}
      </span>

      {/* Line counts */}
      <span className="flex items-center gap-1 text-xs font-mono flex-shrink-0">
        <span style={{ color: "var(--ctp-green)" }}>+{addedLines}</span>
        <span style={{ color: "var(--ctp-red)" }}>-{deletedLines}</span>
      </span>

      <div className="flex-1" />

      {/* Display mode toggle */}
      <div
        className="flex rounded overflow-hidden flex-shrink-0"
        style={{ border: "1px solid var(--ctp-overlay0)" }}
      >
        <button
          className="px-2 py-1 text-xs"
          style={{
            background:
              displayMode === "unified"
                ? "var(--ctp-blue)"
                : "var(--ctp-surface0)",
            color:
              displayMode === "unified"
                ? "var(--ctp-base)"
                : "var(--ctp-subtext0)",
          }}
          onClick={() => onDisplayModeChange("unified")}
          title="Unified view"
        >
          Unified
        </button>
        <button
          className="px-2 py-1 text-xs"
          style={{
            background:
              displayMode === "side-by-side"
                ? "var(--ctp-blue)"
                : "var(--ctp-surface0)",
            color:
              displayMode === "side-by-side"
                ? "var(--ctp-base)"
                : "var(--ctp-subtext0)",
            borderLeft: "1px solid var(--ctp-overlay0)",
          }}
          onClick={() => onDisplayModeChange("side-by-side")}
          title="Side-by-side view"
        >
          Split
        </button>
      </div>

      {/* Hunk navigation */}
      {totalHunks > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-xs"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Hunk {hunkIndex + 1}/{totalHunks}
          </span>
          <button
            className="px-1.5 py-0.5 text-xs rounded"
            style={{
              background: "var(--ctp-surface0)",
              color: hunkIndex <= 0 ? "var(--ctp-overlay0)" : "var(--ctp-text)",
              border: "1px solid var(--ctp-overlay0)",
            }}
            onClick={onPreviousHunk}
            disabled={hunkIndex <= 0}
            title="Previous hunk"
          >
            &#x25B2;
          </button>
          <button
            className="px-1.5 py-0.5 text-xs rounded"
            style={{
              background: "var(--ctp-surface0)",
              color:
                hunkIndex >= totalHunks - 1
                  ? "var(--ctp-overlay0)"
                  : "var(--ctp-text)",
              border: "1px solid var(--ctp-overlay0)",
            }}
            onClick={onNextHunk}
            disabled={hunkIndex >= totalHunks - 1}
            title="Next hunk"
          >
            &#x25BC;
          </button>
        </div>
      )}
    </div>
  );
}
