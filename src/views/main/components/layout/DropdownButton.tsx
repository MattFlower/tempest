import { useState, useRef, useEffect, useCallback } from "react";

export type DropdownItem =
  | { label: string; action: () => void }
  | { separator: true };

interface DropdownButtonProps {
  label: string;
  icon?: React.ReactNode;
  items: DropdownItem[];
  /** Action fired when clicking the main button area (not the chevron). If omitted, the whole button toggles the dropdown. */
  onDefaultAction?: () => void;
  /** Called each time the dropdown opens. Useful for refreshing dynamic items. */
  onOpen?: () => void;
}

export function DropdownButton({ label, icon, items, onDefaultAction, onOpen }: DropdownButtonProps) {
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
        onClick={() => {
          if (!onDefaultAction) {
            setIsOpen((o) => {
              if (!o) onOpen?.();
              return !o;
            });
          }
        }}
        className="flex items-center gap-0 px-0 py-0 text-xs font-medium rounded-md border border-[var(--ctp-surface1)] text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors"
        style={{ backgroundColor: isOpen ? "var(--ctp-surface1)" : "var(--ctp-surface0)" }}
      >
        <span
          className="flex items-center gap-1 px-2.5 py-1"
          onClick={(e) => {
            if (onDefaultAction) {
              e.stopPropagation();
              onDefaultAction();
            }
          }}
        >
          {icon}
          {label}
        </span>
        <span
          className="border-l border-[var(--ctp-surface1)] px-1.5 py-1 flex items-center"
          onClick={(e) => {
            if (onDefaultAction) {
              e.stopPropagation();
              setIsOpen((o) => {
                if (!o) onOpen?.();
                return !o;
              });
            }
          }}
        >
          <svg className="w-3 h-3 text-[var(--ctp-overlay1)]" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-lg overflow-hidden"
          style={{ zIndex: 30 }}
        >
          {items.map((item, i) =>
            "separator" in item ? (
              <div
                key={`sep-${i}`}
                className="my-1 border-t border-[var(--ctp-surface1)]"
              />
            ) : (
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
            ),
          )}
        </div>
      )}
    </div>
  );
}
