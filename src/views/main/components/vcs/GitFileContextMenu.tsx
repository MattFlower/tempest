// ============================================================
// GitFileContextMenu — right-click context menu for Git file entries.
// Options: Revert Change
// ============================================================

import { useEffect, useRef } from "react";

interface GitFileContextMenuProps {
  x: number;
  y: number;
  filePath: string;
  onRevert: () => void;
  onDismiss: () => void;
}

export function GitFileContextMenu({
  x,
  y,
  filePath,
  onRevert,
  onDismiss,
}: GitFileContextMenuProps) {
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

  const fileName = filePath.split("/").pop() ?? filePath;

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
      {/* Header — show file name */}
      <div
        className="px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--ctp-surface1)" }}
      >
        <span
          className="font-mono text-[10px] font-bold truncate block"
          style={{ color: "var(--ctp-overlay1)", maxWidth: 250 }}
        >
          {fileName}
        </span>
      </div>

      {/* Revert Change */}
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-4 transition-colors"
        style={{ color: "var(--ctp-red)", cursor: "pointer" }}
        onClick={() => {
          onRevert();
          onDismiss();
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--ctp-surface1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        }}
      >
        <span>Revert Change</span>
      </button>
    </div>
  );
}
