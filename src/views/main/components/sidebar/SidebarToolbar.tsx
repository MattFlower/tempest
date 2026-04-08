import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  onAddRepo: () => void;
  onCloneRepo: () => void;
}

export function SidebarToolbar({ onAddRepo, onCloneRepo }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenuOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [menuOpen, close]);

  return (
    <div className="flex items-center px-3 py-2 border-t border-[var(--ctp-surface0)] bg-[var(--ctp-mantle)]">
      <button
        onClick={onAddRepo}
        className="flex items-center gap-1.5 text-[12px] text-[var(--ctp-text)] hover:text-[var(--ctp-text)] transition-colors"
        title="Add Repository"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.25 1v6.25H1v1.5h6.25V15h1.5V8.75H15v-1.5H8.75V1h-1.5Z" />
        </svg>
        Add repository
      </button>
      <span className="flex-1" />
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="text-[var(--ctp-text)] hover:text-[var(--ctp-text)] transition-colors p-0.5 rounded"
          style={{ backgroundColor: menuOpen ? "var(--ctp-surface0)" : "transparent" }}
          title="More actions"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 bottom-full mb-1 min-w-[200px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-lg overflow-hidden"
            style={{ zIndex: 30 }}
          >
            <button
              onClick={() => {
                close();
                onCloneRepo();
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors"
            >
              Add Remote Repository
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
