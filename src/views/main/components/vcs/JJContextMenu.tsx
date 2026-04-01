// ============================================================
// JJContextMenu — right-click context menu for revision entries.
// Options: Edit, Set Bookmark...
// ============================================================

import { useEffect, useRef } from "react";

interface JJContextMenuProps {
  x: number;
  y: number;
  changeId: string;
  isImmutable: boolean;
  onEdit: () => void;
  onSetBookmark: () => void;
  onRebaseOnto: () => void;
  onDismiss: () => void;
}

export function JJContextMenu({
  x,
  y,
  changeId,
  isImmutable,
  onEdit,
  onSetBookmark,
  onRebaseOnto,
  onDismiss,
}: JJContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onDismiss]);

  // Keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] rounded-lg shadow-xl overflow-hidden py-1"
      style={{
        left: x,
        top: y,
        backgroundColor: "var(--ctp-surface0)",
        border: "1px solid var(--ctp-surface1)",
        minWidth: 180,
      }}
    >
      {/* Header — show change id */}
      <div
        className="px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--ctp-surface1)" }}
      >
        <span
          className="font-mono text-[10px] font-bold"
          style={{ color: "var(--ctp-overlay1)" }}
        >
          {changeId}
        </span>
      </div>

      {/* Edit */}
      <MenuItem
        label="Edit"
        shortcut="jj edit"
        disabled={isImmutable}
        onClick={() => {
          onEdit();
          onDismiss();
        }}
      />

      {/* Set Bookmark */}
      <MenuItem
        label="Set Bookmark..."
        shortcut="jj bookmark set"
        onClick={() => {
          onSetBookmark();
          onDismiss();
        }}
      />

      {/* Rebase Onto */}
      <MenuItem
        label="Rebase Onto..."
        shortcut="jj rebase"
        disabled={isImmutable}
        onClick={() => {
          onRebaseOnto();
          onDismiss();
        }}
      />
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-4 transition-colors"
      style={{
        color: disabled ? "var(--ctp-overlay0)" : "var(--ctp-text)",
        cursor: disabled ? "default" : "pointer",
      }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--ctp-surface1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
