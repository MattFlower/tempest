import { useEffect, useRef } from "react";

interface MarkdownFindBarProps {
  query: string;
  total: number;
  index: number;
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function MarkdownFindBar({
  query,
  total,
  index,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: MarkdownFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const noMatch = query.length > 0 && total === 0;
  const counter =
    query.length === 0 ? "" : total === 0 ? "No results" : `${index + 1} / ${total}`;

  return (
    <div
      className="absolute top-1 right-4 z-10 flex items-center gap-1 rounded-md px-2 py-1 shadow-lg"
      style={{
        background: "var(--ctp-mantle)",
        border: "1px solid var(--ctp-surface1)",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="min-w-0 rounded px-2 py-1 text-xs outline-none"
        style={{
          width: 180,
          background: noMatch ? "rgba(243,139,168,0.15)" : "rgba(255,255,255,0.06)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
        }}
      />

      {counter && (
        <span
          className="text-[10px] whitespace-nowrap px-1 tabular-nums"
          style={{ color: noMatch ? "var(--ctp-red)" : "var(--ctp-overlay1)" }}
        >
          {counter}
        </span>
      )}

      <NavButton onClick={onPrevious} disabled={total === 0} title="Previous (Shift+Enter)">
        <ChevronUpIcon />
      </NavButton>
      <NavButton onClick={onNext} disabled={total === 0} title="Next (Enter)">
        <ChevronDownIcon />
      </NavButton>
      <NavButton onClick={onClose} title="Close (Escape)">
        <CloseIcon />
      </NavButton>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center rounded p-0.5 transition-colors"
      style={{
        width: 22,
        height: 22,
        color: disabled ? "var(--ctp-surface2)" : "var(--ctp-overlay1)",
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
