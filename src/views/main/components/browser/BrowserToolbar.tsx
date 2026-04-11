// ============================================================
// BrowserToolbar — Navigation bar + find bar for browser tabs.
// Port of Tempest/Browser/BrowserTabView.swift toolbar section.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { api } from "../../state/rpc-client";
import type { Bookmark } from "../../../../shared/ipc-types";
import { normalizeURL, resolveOmniboxInput } from "../../../../shared/url-utils";

// --- Portal Popover ---
// Renders children into document.body so they aren't clipped by
// overflow-hidden ancestors.  Positions itself below the anchor ref.

function Popover({
  anchorRef,
  children,
  onClose,
  width = 280,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position below the anchor, right-aligned
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: Math.max(4, rect.right - width),
    });
  }, [anchorRef, width]);

  if (!pos) return null;

  // Use a transparent backdrop to catch outside clicks.  onMouseDown
  // ensures it fires on the backdrop itself, not on higher-z children.
  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998 }}
        onMouseDown={onClose}
      />
      <div
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width,
          zIndex: 9999,
          background: "var(--ctp-surface0)",
          border: "1px solid var(--ctp-surface1)",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

// --- Toolbar ---

export interface BrowserToolbarProps {
  currentUrl: string;
  pageTitle?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  repoPath: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onPopoverChange?: (open: boolean) => void;
}

export function BrowserToolbar({
  currentUrl,
  pageTitle,
  isLoading,
  canGoBack,
  canGoForward,
  repoPath,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onStop,
  onPopoverChange,
}: BrowserToolbarProps) {
  const [urlText, setUrlText] = useState(currentUrl);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkedURLs, setBookmarkedURLs] = useState<Map<string, string>>(new Map()); // normalized URL → bookmark id
  const [showEditPopover, setShowEditPopover] = useState(false);
  const [showListPopover, setShowListPopover] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const starBtnRef = useRef<HTMLDivElement>(null);
  const listBtnRef = useRef<HTMLDivElement>(null);

  // Sync URL bar when navigation completes
  useEffect(() => {
    setUrlText(currentUrl);
  }, [currentUrl]);

  // Load bookmarks once on mount (and when repoPath changes)
  const refreshBookmarks = useCallback(async () => {
    if (!repoPath) return;
    try {
      const bms = await api.getBookmarks(repoPath);
      setBookmarks(bms);
      setBookmarkedURLs(new Map(bms.map((b: Bookmark) => [normalizeURL(b.url), b.id])));
    } catch {}
  }, [repoPath]);

  useEffect(() => { refreshBookmarks(); }, [refreshBookmarks]);

  const isBookmarked = bookmarkedURLs.has(normalizeURL(currentUrl));

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = urlText.trim();
      if (!input) return;
      onNavigate(resolveOmniboxInput(input));
      urlInputRef.current?.blur();
    }
  };

  const handleUrlFocus = () => {
    urlInputRef.current?.select();
  };

  // Notify parent when any popover opens/closes so it can hide the native webview
  useEffect(() => {
    onPopoverChange?.(showEditPopover || showListPopover);
  }, [showEditPopover, showListPopover, onPopoverChange]);

  const handleStarClick = useCallback(async () => {
    if (!currentUrl || !repoPath) return;
    if (isBookmarked) {
      // Already bookmarked — show edit popover
      setShowEditPopover(true);
    } else {
      // Add bookmark — prefer page title over raw URL
      const label = pageTitle && pageTitle !== "New Tab" ? pageTitle : currentUrl;
      await api.addBookmark(repoPath, currentUrl, label);
      await refreshBookmarks();
    }
  }, [currentUrl, repoPath, isBookmarked, pageTitle, refreshBookmarks]);

  const handleEditDone = useCallback(async () => {
    setShowEditPopover(false);
    await refreshBookmarks();
  }, [refreshBookmarks]);

  const handleListNavigate = useCallback((url: string) => {
    setShowListPopover(false);
    onNavigate(url);
  }, [onNavigate]);

  const handleListChanged = useCallback(async () => {
    await refreshBookmarks();
  }, [refreshBookmarks]);

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

      {/* Bookmark star */}
      <div ref={starBtnRef}>
        <ToolbarButton
          onClick={handleStarClick}
          disabled={!currentUrl}
          title={isBookmarked ? "Edit bookmark" : "Add bookmark"}
        >
          <BookmarkIcon filled={isBookmarked} />
        </ToolbarButton>
      </div>

      {showEditPopover && (
        <Popover anchorRef={starBtnRef} onClose={handleEditDone} width={220}>
          <BookmarkEditPopover
            repoPath={repoPath}
            url={currentUrl}
            bookmarkedURLs={bookmarkedURLs}
            onDone={handleEditDone}
          />
        </Popover>
      )}

      {/* Bookmark list */}
      <div ref={listBtnRef}>
        <ToolbarButton
          onClick={() => setShowListPopover(!showListPopover)}
          title="Bookmarks"
        >
          <BookListIcon />
        </ToolbarButton>
      </div>

      {showListPopover && (
        <Popover anchorRef={listBtnRef} onClose={() => setShowListPopover(false)} width={280}>
          <BookmarkListPopover
            bookmarks={bookmarks}
            repoPath={repoPath}
            onSelect={handleListNavigate}
            onChanged={handleListChanged}
            onClose={() => setShowListPopover(false)}
          />
        </Popover>
      )}
    </div>
  );
}

// --- Bookmark Edit Popover ---

function BookmarkEditPopover({
  repoPath,
  url,
  bookmarkedURLs,
  onDone,
}: {
  repoPath: string;
  url: string;
  bookmarkedURLs: Map<string, string>;
  onDone: () => void;
}) {
  const [labelText, setLabelText] = useState("");
  const [urlText, setUrlText] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);
  const bookmarkId = bookmarkedURLs.get(normalizeURL(url));

  useEffect(() => {
    (async () => {
      if (!repoPath) return;
      const bms = await api.getBookmarks(repoPath);
      const bm = bms.find((b: Bookmark) => b.id === bookmarkId);
      if (bm) {
        setLabelText(bm.label);
        setUrlText(bm.url);
      }
    })();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [repoPath, bookmarkId]);

  const handleSave = async () => {
    if (bookmarkId && labelText.trim() && urlText.trim()) {
      await api.updateBookmark(repoPath, bookmarkId, labelText.trim(), urlText.trim());
    }
    onDone();
  };

  const handleRemove = async () => {
    if (bookmarkId) {
      await api.removeBookmark(repoPath, bookmarkId);
    }
    onDone();
  };

  const fieldStyle = {
    background: "rgba(255,255,255,0.06)",
    color: "var(--ctp-text)",
    border: "1px solid var(--ctp-surface1)",
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs font-semibold" style={{ color: "var(--ctp-text)" }}>
        Edit Bookmark
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px]" style={{ color: "var(--ctp-subtext0)" }}>Name</label>
        <input
          ref={inputRef}
          type="text"
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { e.preventDefault(); onDone(); }
          }}
          placeholder="Label"
          className="rounded px-2 py-1.5 text-xs outline-none"
          style={fieldStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px]" style={{ color: "var(--ctp-subtext0)" }}>URL</label>
        <input
          type="text"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { e.preventDefault(); onDone(); }
          }}
          placeholder="URL"
          className="rounded px-2 py-1.5 text-xs outline-none"
          style={fieldStyle}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onMouseDown={(e) => { e.preventDefault(); handleRemove(); }}
          className="text-[11px] hover:underline px-1 py-0.5"
          style={{ color: "var(--ctp-red)", background: "none", border: "none", cursor: "pointer" }}
        >
          Remove
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
          className="text-[11px] hover:underline px-1 py-0.5"
          style={{ color: "var(--ctp-text)", background: "none", border: "none", cursor: "pointer" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// --- Bookmark List Popover ---

function BookmarkListPopover({
  bookmarks,
  repoPath,
  onSelect,
  onChanged,
  onClose,
}: {
  bookmarks: Bookmark[];
  repoPath: string;
  onSelect: (url: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    await api.removeBookmark(repoPath, id);
    onChanged();
  };

  const handleEditSubmit = async (id: string) => {
    if (editText.trim()) {
      await api.updateBookmark(repoPath, id, editText.trim());
      onChanged();
    }
    setEditingId(null);
  };

  const startEdit = (bookmark: Bookmark) => {
    setEditText(bookmark.label);
    setEditingId(bookmark.id);
  };

  return (
    <div>
      <div
        className="px-3 pt-2.5 pb-1.5 text-xs font-semibold"
        style={{ color: "var(--ctp-text)" }}
      >
        Bookmarks
      </div>

      <div style={{ borderTop: "1px solid var(--ctp-surface1)" }} />

      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-5 text-center">
          <span className="text-xs" style={{ color: "var(--ctp-overlay0)" }}>
            No bookmarks yet
          </span>
          <span className="text-[10px]" style={{ color: "var(--ctp-surface2)" }}>
            Click the star icon to bookmark a page
          </span>
        </div>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
          {bookmarks.map((bookmark) => (
            <div
              key={bookmark.id}
              className="flex items-center gap-2 px-3 py-1.5"
              style={{
                cursor: editingId === bookmark.id ? "default" : "pointer",
                background: hoveredId === bookmark.id ? "rgba(255,255,255,0.04)" : "transparent",
              }}
              onMouseEnter={() => setHoveredId(bookmark.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => {
                if (editingId === null) onSelect(bookmark.url);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                startEdit(bookmark);
              }}
            >
              {editingId === bookmark.id ? (
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleEditSubmit(bookmark.id);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs outline-none"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--ctp-text)",
                    border: "1px solid var(--ctp-surface1)",
                  }}
                />
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div
                      className="truncate text-xs"
                      style={{ color: "var(--ctp-text)" }}
                    >
                      {bookmark.label}
                    </div>
                    <div
                      className="truncate text-[10px]"
                      style={{ color: "var(--ctp-overlay0)" }}
                    >
                      {bookmark.url}
                    </div>
                  </div>

                  {hoveredId === bookmark.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(bookmark.id);
                      }}
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 16,
                        height: 16,
                        color: "var(--ctp-overlay0)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                      title="Delete bookmark"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
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

function BookListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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
