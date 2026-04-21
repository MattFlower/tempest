import { useState, useEffect, useRef, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { FindInFilesResult } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { addTab } from "../../state/actions";
import { useStore } from "../../state/store";
import { OverlayWrapper } from "../../state/useOverlay";
import { api } from "../../state/rpc-client";

const DEBOUNCE_MS = 200;

function relativeDisplayPath(filePath: string, workspacePath: string | null): string {
  if (!workspacePath) return filePath;
  if (filePath.startsWith(workspacePath + "/")) {
    return filePath.slice(workspacePath.length + 1);
  }
  return filePath;
}

export function FindInFiles() {
  const visible = useStore((s) => s.findInFilesVisible);
  const setVisible = useStore((s) => s.setFindInFilesVisible);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const focusedPaneId = useStore((s) => s.focusedPaneId);

  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindInFilesResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setResult(null);
      setSelectedIndex(0);
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const trimmed = query.trim();
    if (!trimmed || !selectedWorkspacePath) {
      setResult(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++requestIdRef.current;
      try {
        const res = await api.findInFiles({
          workspacePath: selectedWorkspacePath,
          query: trimmed,
          isRegex,
          caseSensitive,
        });
        if (reqId !== requestIdRef.current) return;
        setResult(res);
        setSelectedIndex(0);
      } catch (e: any) {
        if (reqId !== requestIdRef.current) return;
        setResult({ matches: [], truncated: false, error: e?.message ?? "Search failed" });
      } finally {
        if (reqId === requestIdRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query, isRegex, caseSensitive, selectedWorkspacePath, visible]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const dismiss = useCallback(() => setVisible(false), [setVisible]);

  const openMatch = useCallback(
    (filePath: string, lineNumber: number) => {
      if (!focusedPaneId) return;
      const name = filePath.split("/").pop() ?? "File";
      const isMarkdown = /\.(?:md|markdown)$/i.test(name);
      if (isMarkdown) {
        addTab(
          focusedPaneId,
          createTab(PaneTabKind.MarkdownViewer, name, { markdownFilePath: filePath }),
        );
        return;
      }
      // Terminal-based editors (nvim, vim, hx, etc.) need a terminalId to host
      // the PTY. Monaco runs entirely in the webview and doesn't.
      const isMonaco = useStore.getState().config?.editor === "monaco";
      addTab(
        focusedPaneId,
        createTab(PaneTabKind.Editor, name, {
          editorFilePath: filePath,
          editorLineNumber: lineNumber,
          ...(isMonaco ? {} : { terminalId: crypto.randomUUID() }),
        }),
      );
    },
    [focusedPaneId],
  );

  const executeSelected = useCallback(() => {
    const matches = result?.matches ?? [];
    const match = matches[selectedIndex];
    if (!match) return;
    dismiss();
    openMatch(match.filePath, match.lineNumber);
  }, [result, selectedIndex, dismiss, openMatch]);

  const matches = result?.matches ?? [];
  const itemCount = matches.length;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(Math.max(0, itemCount - 1), i + 1));
          break;
        case "Enter":
          e.preventDefault();
          executeSelected();
          break;
        case "Escape":
          e.preventDefault();
          dismiss();
          break;
      }
    },
    [itemCount, executeSelected, dismiss],
  );

  if (!visible) return null;

  const hasError = !!result?.error;
  const trimmedQuery = query.trim();
  const showEmpty = !!result && !hasError && matches.length === 0 && !!trimmedQuery;

  return (
    <OverlayWrapper>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[15%]"
        onClick={dismiss}
      >
        <div
          className="w-[560px] flex flex-col rounded-xl border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Search input + toggles */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <svg
              className="w-4 h-4 text-[var(--ctp-overlay1)] flex-shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"
                clipRule="evenodd"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={selectedWorkspacePath ? "Find in files…" : "Select a workspace first"}
              disabled={!selectedWorkspacePath}
              className="flex-1 bg-transparent text-[13px] text-[var(--ctp-text)] placeholder:text-[var(--ctp-overlay0)] outline-none"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
            <ToggleButton
              label="Aa"
              title="Match case"
              active={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            />
            <ToggleButton
              label=".*"
              title="Use regular expression"
              active={isRegex}
              onClick={() => setIsRegex((v) => !v)}
            />
          </div>

          <div className="h-px bg-[var(--ctp-surface1)]" />

          {/* Results */}
          <div
            ref={listRef}
            className="max-h-[420px] overflow-y-auto py-1 px-1.5"
          >
            {!selectedWorkspacePath ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">
                Select a workspace first
              </div>
            ) : hasError ? (
              <div className="py-6 px-3 text-[12px] text-[var(--ctp-red)]">
                {result!.error}
              </div>
            ) : searching && matches.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">
                Searching…
              </div>
            ) : showEmpty ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">
                No matches
              </div>
            ) : !trimmedQuery ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">
                Start typing to search…
              </div>
            ) : (
              matches.map((match, index) => (
                <MatchRow
                  key={`${match.filePath}:${match.lineNumber}:${index}`}
                  relativePath={relativeDisplayPath(match.filePath, selectedWorkspacePath)}
                  lineNumber={match.lineNumber}
                  lineText={match.lineText}
                  submatches={match.submatches}
                  isSelected={index === selectedIndex}
                  onClick={() => {
                    dismiss();
                    openMatch(match.filePath, match.lineNumber);
                  }}
                  onHover={() => setSelectedIndex(index)}
                />
              ))
            )}
          </div>

          <div className="h-px bg-[var(--ctp-surface1)]" />

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-1.5">
            <div className="flex items-center gap-4">
              <FooterHint keys="↑↓" label="navigate" />
              <FooterHint keys="⏎" label="open" />
              <FooterHint keys="esc" label="dismiss" />
            </div>
            <div className="text-[10px] text-[var(--ctp-overlay0)]">
              {result?.truncated
                ? `Showing first ${matches.length} matches — refine your query`
                : matches.length > 0
                  ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}`
                  : ""}
            </div>
          </div>
        </div>
      </div>
    </OverlayWrapper>
  );
}

function ToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
        active
          ? "bg-[var(--ctp-surface1)] text-[var(--ctp-text)]"
          : "text-[var(--ctp-overlay0)] hover:text-[var(--ctp-subtext0)]"
      }`}
    >
      {label}
    </button>
  );
}

function MatchRow({
  relativePath,
  lineNumber,
  lineText,
  submatches,
  isSelected,
  onClick,
  onHover,
}: {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  submatches: { start: number; end: number }[];
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      role="button"
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex flex-col rounded-lg px-3 py-1.5 cursor-pointer ${
        isSelected ? "bg-[var(--ctp-surface1)]" : ""
      }`}
    >
      <div className="text-[11px] text-[var(--ctp-overlay1)] truncate">
        {relativePath}
        <span className="text-[var(--ctp-overlay0)]">:{lineNumber}</span>
      </div>
      <div className="text-[12px] text-[var(--ctp-subtext0)] font-mono truncate">
        <HighlightedLine text={lineText} spans={submatches} />
      </div>
    </div>
  );
}

/**
 * Render lineText with submatch byte-ranges bolded.
 * Ripgrep emits byte offsets; for ASCII-heavy source this matches string indices.
 * Non-ASCII may render slightly off but won't crash — the worst case is a
 * mis-aligned highlight on a line with multibyte characters.
 */
function HighlightedLine({
  text,
  spans,
}: {
  text: string;
  spans: { start: number; end: number }[];
}) {
  if (!spans.length) return <>{text}</>;

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const { start, end } = sorted[i]!;
    const s = Math.max(start, cursor);
    const e = Math.min(end, text.length);
    if (s > cursor) parts.push(text.slice(cursor, s));
    if (e > s) {
      parts.push(
        <span key={i} className="font-bold text-[var(--ctp-text)]">
          {text.slice(s, e)}
        </span>,
      );
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-[var(--ctp-overlay0)]">
      <span className="font-medium">{keys}</span>
      <span>{label}</span>
    </div>
  );
}
