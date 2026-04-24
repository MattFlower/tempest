// ============================================================
// SessionList — Port of SessionListView.swift
// Scrollable list of session summaries with search bar
// and scope toggle.
// ============================================================

import { useCallback, useMemo } from "react";
import type { SessionSummary } from "../../../../shared/ipc-types";

export type HistoryProvider = "claude" | "pi" | "codex";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedFilePath: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  scope: "all" | "project";
  onScopeChange: (scope: "all" | "project") => void;
  provider: HistoryProvider;
  onProviderChange: (provider: HistoryProvider) => void;
  hasProjectScope: boolean;
  onSelectSession: (filePath: string) => void;
  showRipgrepHint?: boolean;
}

/** Format an ISO date string as a relative time (e.g. "3h ago", "2d ago") */
function formatRelativeDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  } catch {
    return isoString;
  }
}

/** Strip HTML/XML tags from a string */
function stripTags(str: string): string {
  let result = str;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]+>/g, "");
  } while (result !== previous);
  return result.trim();
}

export function SessionList({
  sessions,
  selectedFilePath,
  searchQuery,
  onSearchQueryChange,
  scope,
  onScopeChange,
  provider,
  onProviderChange,
  hasProjectScope,
  onSelectSession,
  showRipgrepHint,
}: SessionListProps) {
  const clearSearch = useCallback(
    () => onSearchQueryChange(""),
    [onSearchQueryChange],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div
        className="flex items-center gap-2 px-2 py-2 shrink-0"
        style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
      >
        <span
          className="text-xs"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {"\uD83D\uDD0D"}
        </span>
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-[13px]"
          style={{ color: "var(--ctp-text)" }}
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="text-xs cursor-pointer px-1"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {"\u2715"}
          </button>
        )}
      </div>

      {/* Provider toggle */}
      <div className="flex gap-1 px-2 pt-1 shrink-0">
        <ScopeButton
          label="Claude"
          isActive={provider === "claude"}
          onClick={() => onProviderChange("claude")}
        />
        <ScopeButton
          label="Pi"
          isActive={provider === "pi"}
          onClick={() => onProviderChange("pi")}
        />
        <ScopeButton
          label="Codex"
          isActive={provider === "codex"}
          onClick={() => onProviderChange("codex")}
        />
      </div>

      {/* Scope toggle */}
      <div className="flex gap-1 px-2 py-1 shrink-0">
        {hasProjectScope && (
          <ScopeButton
            label="This Project"
            isActive={scope === "project"}
            onClick={() => onScopeChange("project")}
          />
        )}
        <ScopeButton
          label="All Projects"
          isActive={scope === "all"}
          onClick={() => onScopeChange("all")}
        />
      </div>

      <div
        className="shrink-0"
        style={{
          height: 1,
          backgroundColor: "var(--ctp-surface0)",
        }}
      />

      {/* Ripgrep install hint */}
      {showRipgrepHint && (
        <div
          className="flex items-center gap-1 px-2.5 py-1.5 shrink-0 text-[11px]"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          <span>&#9432;</span>
          <span>Install ripgrep for full search: brew install ripgrep</span>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.filePath}
              session={session}
              isSelected={session.filePath === selectedFilePath}
              onSelect={onSelectSession}
            />
          ))}
          {sessions.length === 0 && (
            <div
              className="flex items-center justify-center h-20 text-xs"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              {searchQuery ? "No matching sessions" : "No sessions found"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Session Row ---

function SessionRow({
  session,
  isSelected,
  onSelect,
}: {
  session: SessionSummary;
  isSelected: boolean;
  onSelect: (filePath: string) => void;
}) {
  const handleClick = useCallback(
    () => onSelect(session.filePath),
    [onSelect, session.filePath],
  );

  const displayTitle = useMemo(
    () => stripTags(session.firstPrompt),
    [session.firstPrompt],
  );

  return (
    <button
      onClick={handleClick}
      className="w-full text-left px-2.5 py-2 rounded-md cursor-pointer"
      style={{
        backgroundColor: isSelected
          ? "rgba(137, 180, 250, 0.15)"
          : "transparent",
      }}
    >
      <div
        className="text-[13px] font-semibold leading-tight"
        style={{
          color: "var(--ctp-text)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
        }}
      >
        {displayTitle || "Untitled Session"}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {(session.modifiedAt ?? session.createdAt) && (
          <span
            className="text-[11px]"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {formatRelativeDate(
              (session.modifiedAt ?? session.createdAt)!,
            )}
          </span>
        )}
        {session.gitBranch && (
          <span
            className="text-[11px] px-1 py-px rounded"
            style={{
              color: "var(--ctp-text)",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            {session.gitBranch}
          </span>
        )}
      </div>
    </button>
  );
}

// --- Scope Button ---

function ScopeButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2.5 py-0.5 rounded cursor-pointer"
      style={{
        backgroundColor: isActive
          ? "var(--ctp-blue)"
          : "rgba(255,255,255,0.05)",
        color: isActive ? "white" : "var(--ctp-text)",
      }}
    >
      {label}
    </button>
  );
}
