// ============================================================
// HistoryViewer — Port of HistoryViewerView.swift
// Main orchestrator: two-panel layout with session list on left,
// message stream on right. Search bar at top.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionSummary, SessionMessage } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { SessionList, type HistoryProvider } from "./SessionList";
import { MessageStream } from "./MessageStream";

/** Hook to track element width for responsive layout */
function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function HistoryViewer() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scope, setScope] = useState<"all" | "project">(
    selectedWorkspacePath ? "project" : "all",
  );
  const [provider, setProvider] = useState<HistoryProvider>("claude");
  const [showingMessageStream, setShowingMessageStream] = useState(false);
  const [isSearchAvailable, setIsSearchAvailable] = useState(true);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [containerRef, containerWidth] = useContainerWidth();
  const isNarrow = containerWidth < 600;

  const hasProjectScope = !!selectedWorkspacePath;

  // Check ripgrep availability on mount and whenever provider changes
  useEffect(() => {
    api
      .isHistorySearchAvailable(provider)
      .then(setIsSearchAvailable)
      .catch(() => {});
  }, [provider]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    const effectiveWorkspacePath =
      scope === "project" ? selectedWorkspacePath ?? undefined : undefined;
    try {
      let result: SessionSummary[];
      if (searchQuery.trim()) {
        result = await api.searchHistory(
          searchQuery.trim(),
          scope,
          effectiveWorkspacePath,
          provider,
        );
      } else {
        result = await api.getHistorySessions(
          scope,
          effectiveWorkspacePath,
          provider,
        );
      }
      setSessions(result);

      // If the selected session is no longer in the list, clear it
      if (
        selectedFilePath &&
        !result.some((s) => s.filePath === selectedFilePath)
      ) {
        setSelectedFilePath(null);
        setMessages([]);
      }
    } catch (err) {
      console.error("[HistoryViewer] load sessions error:", err);
    }
  }, [searchQuery, scope, selectedWorkspacePath, provider, selectedFilePath]);

  // Initial load and reload whenever scope/provider/workspace changes
  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, provider, selectedWorkspacePath]);

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      loadSessions();
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, loadSessions]);

  // Refresh timer (30s)
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      loadSessions();
    }, 30_000);
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [loadSessions]);

  // Select a session and load its messages
  const selectSession = useCallback(async (filePath: string) => {
    setSelectedFilePath(filePath);
    setShowingMessageStream(true);
    try {
      const msgs = await api.getSessionMessages(filePath);
      // Guard against a newer selection overwriting
      setSelectedFilePath((currentPath) => {
        if (currentPath === filePath) {
          setMessages(msgs);
        }
        return currentPath;
      });
    } catch (err) {
      console.error("[HistoryViewer] load messages error:", err);
    }
  }, []);

  const selectedSummary = sessions.find(
    (s) => s.filePath === selectedFilePath,
  );

  const showRipgrepHint = !isSearchAvailable && !!searchQuery.trim();

  const sessionListProps = {
    sessions,
    selectedFilePath,
    searchQuery,
    onSearchQueryChange: setSearchQuery,
    scope,
    onScopeChange: setScope,
    provider,
    onProviderChange: setProvider,
    hasProjectScope,
    onSelectSession: selectSession,
    showRipgrepHint,
  };

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      {isNarrow ? (
        // Narrow layout: single panel with back navigation
        <div className="flex flex-col h-full w-full">
          {showingMessageStream && selectedSummary ? (
            <>
              <div
                className="flex items-center shrink-0"
                style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
              >
                <button
                  onClick={() => setShowingMessageStream(false)}
                  className="flex items-center gap-1 px-2 py-2 text-xs cursor-pointer"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  <span>&#9664;</span>
                  <span>Sessions</span>
                </button>
              </div>
              <div
                className="shrink-0"
                style={{ height: 1, backgroundColor: "var(--ctp-surface0)" }}
              />
              <div className="flex-1 min-h-0">
                <MessageStream
                  messages={messages}
                  summary={selectedSummary}
                  searchQuery={searchQuery}
                  provider={provider}
                />
              </div>
            </>
          ) : (
            <SessionList {...sessionListProps} />
          )}
        </div>
      ) : (
        // Wide layout: two-panel
        <div className="flex h-full w-full">
          <div
            className="flex-shrink-0 h-full"
            style={{
              width: 280,
              borderRight: "1px solid var(--ctp-surface0)",
            }}
          >
            <SessionList {...sessionListProps} />
          </div>

          <div className="flex-1 h-full min-w-0">
            {selectedSummary ? (
              <MessageStream
                messages={messages}
                summary={selectedSummary}
                searchQuery={searchQuery}
                provider={provider}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center h-full gap-2"
                style={{ color: "var(--ctp-subtext0)" }}
              >
                <span className="text-2xl opacity-40">{"\uD83D\uDCAC"}</span>
                <span className="text-sm">Select a Session</span>
                <span className="text-xs opacity-60">
                  Choose a session from the list to view its messages.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
