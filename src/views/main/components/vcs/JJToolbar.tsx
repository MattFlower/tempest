// ============================================================
// JJToolbar — action buttons: New, Fetch, Push, Undo.
// Fetch and Push have dropdown menus for options.
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import type { JJBookmark } from "../../../../shared/ipc-types";

interface JJToolbarProps {
  bookmarks: JJBookmark[];
  onNew: () => void;
  onFetch: (remote?: string, allRemotes?: boolean) => void;
  onPush: (bookmark?: string, allTracked?: boolean) => void;
  onUndo: () => void;
  isLoading: boolean;
}

// Generic dropdown hook
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return { open, setOpen, ref };
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  hasDropdown,
  onDropdownClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  hasDropdown?: boolean;
  onDropdownClick?: () => void;
}) {
  return (
    <div className="flex items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-l transition-colors"
        style={{
          backgroundColor: "var(--ctp-surface0)",
          color: disabled ? "var(--ctp-overlay0)" : "var(--ctp-text)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          borderRadius: hasDropdown ? "6px 0 0 6px" : "6px",
        }}
      >
        <span>{icon}</span>
        {label}
      </button>
      {hasDropdown && (
        <button
          onClick={onDropdownClick}
          disabled={disabled}
          className="flex items-center px-1.5 py-1 text-xs rounded-r transition-colors"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: disabled ? "var(--ctp-overlay0)" : "var(--ctp-text)",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            borderLeft: "1px solid var(--ctp-surface1)",
            borderRadius: "0 6px 6px 0",
          }}
        >
          &#x25BE;
        </button>
      )}
    </div>
  );
}

export function JJToolbar({
  bookmarks,
  onNew,
  onFetch,
  onPush,
  onUndo,
  isLoading,
}: JJToolbarProps) {
  const fetchDropdown = useDropdown();
  const pushDropdown = useDropdown();
  const [pushSearch, setPushSearch] = useState("");

  const filteredBookmarks = bookmarks.filter((b) =>
    b.name.toLowerCase().includes(pushSearch.toLowerCase()),
  );

  const handleFetchOrigin = useCallback(() => {
    fetchDropdown.setOpen(false);
    onFetch("origin");
  }, [onFetch, fetchDropdown]);

  const handleFetchAll = useCallback(() => {
    fetchDropdown.setOpen(false);
    onFetch(undefined, true);
  }, [onFetch, fetchDropdown]);

  const handlePushAllTracked = useCallback(() => {
    pushDropdown.setOpen(false);
    onPush(undefined, true);
  }, [onPush, pushDropdown]);

  const handlePushBookmark = useCallback(
    (bookmark: string) => {
      pushDropdown.setOpen(false);
      onPush(bookmark);
    },
    [onPush, pushDropdown],
  );

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      {/* New */}
      <ToolbarButton
        label="New"
        icon="+"
        onClick={onNew}
        disabled={isLoading}
      />

      {/* Fetch with dropdown */}
      <div className="relative" ref={fetchDropdown.ref}>
        <ToolbarButton
          label="Fetch"
          icon="&#x2193;"
          onClick={handleFetchOrigin}
          disabled={isLoading}
          hasDropdown
          onDropdownClick={() => fetchDropdown.setOpen(!fetchDropdown.open)}
        />
        {fetchDropdown.open && (
          <div
            className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-lg overflow-hidden"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
              minWidth: 180,
            }}
          >
            <button
              className="w-full text-left px-3 py-2 text-xs hover:opacity-80 transition-opacity"
              style={{ color: "var(--ctp-text)" }}
              onClick={handleFetchAll}
            >
              All Remotes
            </button>
            <div
              style={{
                borderTop: "1px solid var(--ctp-surface1)",
              }}
            />
            <button
              className="w-full text-left px-3 py-2 text-xs hover:opacity-80 transition-opacity"
              style={{ color: "var(--ctp-text)" }}
              onClick={handleFetchOrigin}
            >
              Origin
            </button>
          </div>
        )}
      </div>

      {/* Push with dropdown */}
      <div className="relative" ref={pushDropdown.ref}>
        <ToolbarButton
          label="Push"
          icon="&#x2191;"
          onClick={handlePushAllTracked}
          disabled={isLoading}
          hasDropdown
          onDropdownClick={() => {
            pushDropdown.setOpen(!pushDropdown.open);
            setPushSearch("");
          }}
        />
        {pushDropdown.open && (
          <div
            className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-lg overflow-hidden"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
              minWidth: 220,
            }}
          >
            <button
              className="w-full text-left px-3 py-2 text-xs hover:opacity-80 transition-opacity flex items-center gap-2"
              style={{ color: "var(--ctp-text)" }}
              onClick={handlePushAllTracked}
            >
              <span>&#x2191;</span> All tracked bookmarks
            </button>

            <div
              className="px-3 py-1.5"
              style={{ borderTop: "1px solid var(--ctp-surface1)" }}
            >
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--ctp-overlay0)" }}
              >
                Bookmarks
              </span>
            </div>

            {/* Search */}
            <div className="px-2 pb-1">
              <input
                type="text"
                value={pushSearch}
                onChange={(e) => setPushSearch(e.target.value)}
                placeholder="Search bookmarks..."
                className="w-full text-xs px-2 py-1 rounded outline-none"
                style={{
                  backgroundColor: "var(--ctp-base)",
                  color: "var(--ctp-text)",
                  border: "1px solid var(--ctp-surface1)",
                }}
                autoFocus
              />
            </div>

            {/* Bookmark list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredBookmarks.length === 0 ? (
                <div
                  className="px-3 py-2 text-[10px]"
                  style={{ color: "var(--ctp-overlay0)" }}
                >
                  No bookmarks found
                </div>
              ) : (
                filteredBookmarks.map((bm) => (
                  <button
                    key={bm.name}
                    className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
                    style={{ color: "var(--ctp-text)" }}
                    onClick={() => handlePushBookmark(bm.name)}
                  >
                    {bm.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Undo */}
      <ToolbarButton
        label="Undo"
        icon="&#x21A9;"
        onClick={onUndo}
        disabled={isLoading}
      />
    </div>
  );
}
