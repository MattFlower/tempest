import { useState, useRef, useEffect, useCallback } from "react";

export interface DropdownItem {
  label: string;
  action: () => void;
}

interface DropdownButtonProps {
  label: string;
  icon?: React.ReactNode;
  items: DropdownItem[];
}

export function DropdownButton({ label, icon, items }: DropdownButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors"
        style={{ backgroundColor: isOpen ? "var(--ctp-surface1)" : "transparent" }}
      >
        {icon}
        {label}
        <svg className="w-3 h-3 text-[var(--ctp-overlay1)]" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-lg overflow-hidden"
          style={{ zIndex: 30 }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                close();
                item.action();
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
