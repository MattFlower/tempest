// ============================================================
// DiffContextMenu — right-click context menu for diff lines.
// Port of WebDiffRenderer.swift's context menu handler.
// Renders via portal to document.body to escape the stacking
// context created by the view mode overlay containers.
// ============================================================

import { createPortal } from "react-dom";
import { useOverlay } from "../../state/useOverlay";

interface DiffContextMenuProps {
  x: number;
  y: number;
  lineNumber: number | null;
  onOpenInEditor: () => void;
  onDismiss: () => void;
}

export function DiffContextMenu({
  x,
  y,
  lineNumber,
  onOpenInEditor,
  onDismiss,
}: DiffContextMenuProps) {
  useOverlay();
  const label =
    lineNumber != null
      ? `Open in Editor at Line ${lineNumber}`
      : "Open in Editor";

  return createPortal(
    <>
      {/* Backdrop to catch clicks outside */}
      <div className="fixed inset-0 z-50" onClick={onDismiss} />
      <div
        className="fixed z-[51] py-1 rounded shadow-lg min-w-[180px]"
        style={{
          left: x,
          top: y,
          background: "var(--ctp-surface0)",
          border: "1px solid var(--ctp-surface1)",
        }}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-xs hover:opacity-80"
          style={{ color: "var(--ctp-text)" }}
          onClick={onOpenInEditor}
        >
          {label}
        </button>
      </div>
    </>,
    document.getElementById("root")!,
  );
}
