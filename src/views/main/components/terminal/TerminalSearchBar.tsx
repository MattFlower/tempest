import { useState, useRef, useEffect, useCallback } from "react";
import type { TerminalInstance } from "./terminal-instance";

interface TerminalSearchBarProps {
  instance: TerminalInstance;
  onClose: () => void;
}

export function TerminalSearchBar({ instance, onClose }: TerminalSearchBarProps) {
  const [searchText, setSearchText] = useState("");
  const [hasMatch, setHasMatch] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const searchOptions = useCallback(() => ({
    caseSensitive,
    regex,
    wholeWord,
    incremental: true,
  }), [caseSensitive, regex, wholeWord]);

  // Search as you type
  useEffect(() => {
    if (searchText) {
      const found = instance.searchAddon.findNext(searchText, searchOptions());
      setHasMatch(found);
    } else {
      instance.searchAddon.clearDecorations();
      setHasMatch(false);
    }
  }, [searchText, caseSensitive, regex, wholeWord, instance, searchOptions]);

  const findNext = useCallback(() => {
    if (searchText) {
      const found = instance.searchAddon.findNext(searchText, { ...searchOptions(), incremental: false });
      setHasMatch(found);
    }
  }, [searchText, instance, searchOptions]);

  const findPrevious = useCallback(() => {
    if (searchText) {
      const found = instance.searchAddon.findPrevious(searchText, searchOptions());
      setHasMatch(found);
    }
  }, [searchText, instance, searchOptions]);

  const handleClose = useCallback(() => {
    instance.searchAddon.clearDecorations();
    onClose();
    instance.focus();
  }, [instance, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  const noMatch = searchText.length > 0 && !hasMatch;

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
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="min-w-0 rounded px-2 py-1 text-xs outline-none"
        style={{
          width: 160,
          background: noMatch ? "rgba(243,139,168,0.15)" : "rgba(255,255,255,0.06)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
        }}
      />

      {searchText && noMatch && (
        <span
          className="text-[10px] whitespace-nowrap px-1"
          style={{ color: "var(--ctp-red)" }}
        >
          No results
        </span>
      )}

      {/* Toggle buttons */}
      <ToggleButton active={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)} title="Match Case">
        Aa
      </ToggleButton>
      <ToggleButton active={wholeWord} onClick={() => setWholeWord(!wholeWord)} title="Whole Word">
        <WholeWordIcon />
      </ToggleButton>
      <ToggleButton active={regex} onClick={() => setRegex(!regex)} title="Use Regex">
        .*
      </ToggleButton>

      {/* Nav buttons */}
      <NavButton onClick={findPrevious} disabled={!searchText} title="Previous (Shift+Enter)">
        <ChevronUpIcon />
      </NavButton>
      <NavButton onClick={findNext} disabled={!searchText} title="Next (Enter)">
        <ChevronDownIcon />
      </NavButton>
      <NavButton onClick={handleClose} title="Close (Escape)">
        <CloseIcon />
      </NavButton>
    </div>
  );
}

function ToggleButton({ active, onClick, title, children }: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded text-[11px] font-mono transition-colors"
      style={{
        width: 22,
        height: 22,
        color: active ? "var(--ctp-text)" : "var(--ctp-overlay0)",
        background: active ? "var(--ctp-surface1)" : "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function NavButton({ onClick, disabled, title, children }: {
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

function WholeWordIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" fontFamily="monospace">W</text>
    </svg>
  );
}
