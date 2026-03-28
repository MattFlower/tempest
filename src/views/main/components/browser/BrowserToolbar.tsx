// ============================================================
// BrowserToolbar — Navigation bar + find bar for browser tabs.
// Port of Tempest/Browser/BrowserTabView.swift toolbar section.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../../state/rpc-client";
import type { Bookmark } from "../../../../shared/ipc-types";
import { normalizeURL } from "../../../../shared/url-utils";

// --- Toolbar ---

export interface BrowserToolbarProps {
  currentUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  repoPath: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

export function BrowserToolbar({
  currentUrl,
  isLoading,
  canGoBack,
  canGoForward,
  repoPath,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onStop,
}: BrowserToolbarProps) {
  const [urlText, setUrlText] = useState(currentUrl);
  const [bookmarkedURLs, setBookmarkedURLs] = useState<Map<string, string>>(new Map()); // normalized URL → bookmark id
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Sync URL bar when navigation completes
  useEffect(() => {
    setUrlText(currentUrl);
  }, [currentUrl]);

  // Load bookmarks once on mount (and when repoPath changes)
  const refreshBookmarks = useCallback(async () => {
    if (!repoPath) return;
    try {
      const bms = await api.getBookmarks(repoPath);
      setBookmarkedURLs(new Map(bms.map((b: Bookmark) => [normalizeURL(b.url), b.id])));
    } catch {}
  }, [repoPath]);

  useEffect(() => { refreshBookmarks(); }, [refreshBookmarks]);

  const isBookmarked = bookmarkedURLs.has(normalizeURL(currentUrl));

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      let url = urlText.trim();
      if (!url) return;
      if (!url.includes("://")) {
        url = "https://" + url;
      }
      onNavigate(url);
      urlInputRef.current?.blur();
    }
  };

  const handleUrlFocus = () => {
    urlInputRef.current?.select();
  };

  const toggleBookmark = useCallback(async () => {
    if (!currentUrl || !repoPath) return;
    const normalized = normalizeURL(currentUrl);
    if (isBookmarked) {
      const bmId = bookmarkedURLs.get(normalized);
      if (bmId) await api.removeBookmark(repoPath, bmId);
    } else {
      await api.addBookmark(repoPath, currentUrl, currentUrl);
    }
    await refreshBookmarks();
  }, [currentUrl, repoPath, isBookmarked, bookmarkedURLs, refreshBookmarks]);

  return (
    <div
      className="flex items-center gap-1 border-b px-2 py-1"
      style={{
        background: "var(--ctp-mantle)",
        borderColor: "var(--ctp-surface0)",
      }}
    >
      <ToolbarButton
        onClick={onGoBack}
        disabled={!canGoBack}
        title="Back"
      >
        <BackIcon />
      </ToolbarButton>

      <ToolbarButton
        onClick={onGoForward}
        disabled={!canGoForward}
        title="Forward"
      >
        <ForwardIcon />
      </ToolbarButton>

      <ToolbarButton
        onClick={isLoading ? onStop : onReload}
        title={isLoading ? "Stop" : "Reload"}
      >
        {isLoading ? <StopIcon /> : <ReloadIcon />}
      </ToolbarButton>

      <input
        ref={urlInputRef}
        type="text"
        value={urlText}
        onChange={(e) => setUrlText(e.target.value)}
        onKeyDown={handleUrlKeyDown}
        onFocus={handleUrlFocus}
        placeholder="Enter URL…"
        className="flex-1 min-w-0 rounded px-2 py-1 text-xs outline-none"
        style={{
          background: "rgba(255,255,255,0.06)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
        }}
      />

      <ToolbarButton
        onClick={toggleBookmark}
        disabled={!currentUrl}
        title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
      >
        <BookmarkIcon filled={isBookmarked} />
      </ToolbarButton>
    </div>
  );
}

// --- Find Bar ---

export interface FindBarProps {
  findText: string;
  findHasMatch: boolean;
  onFindTextChange: (text: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
}

export function FindBar({
  findText,
  findHasMatch,
  onFindTextChange,
  onFindNext,
  onFindPrevious,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onFindNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const noMatch = findText.length > 0 && !findHasMatch;

  return (
    <div
      className="flex items-center gap-1 px-2 py-1"
      style={{
        background: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={findText}
        onChange={(e) => onFindTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page…"
        className="min-w-0 rounded px-2 py-1 text-xs outline-none"
        style={{
          width: 200,
          background: noMatch ? "rgba(243,139,168,0.15)" : "rgba(255,255,255,0.06)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
        }}
      />

      <ToolbarButton
        onClick={onFindPrevious}
        disabled={!findText}
        title="Previous match"
      >
        <FindPrevIcon />
      </ToolbarButton>

      <ToolbarButton
        onClick={onFindNext}
        disabled={!findText}
        title="Next match"
      >
        <FindNextIcon />
      </ToolbarButton>

      <ToolbarButton onClick={onClose} title="Close find bar">
        <CloseIcon />
      </ToolbarButton>
    </div>
  );
}

// --- Button component ---

function ToolbarButton({
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
      className="flex items-center justify-center rounded p-1 transition-colors"
      style={{
        width: 26,
        height: 26,
        color: disabled ? "var(--ctp-surface2)" : "var(--ctp-overlay1)",
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
        border: "none",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.color = "var(--ctp-text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = disabled
          ? "var(--ctp-surface2)"
          : "var(--ctp-overlay1)";
      }}
    >
      {children}
    </button>
  );
}

// --- SVG Icons (minimal inline) ---

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "var(--ctp-yellow)" : "none"} stroke={filled ? "var(--ctp-yellow)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function FindPrevIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function FindNextIcon() {
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
