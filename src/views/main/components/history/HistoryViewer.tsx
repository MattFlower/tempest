// ============================================================
// HistoryViewer — Port of HistoryViewerView.swift
// Main orchestrator: two-panel layout with session list on left,
// message stream on right. Search bar at top.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionSummary, SessionMessage } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { SessionList } from "./SessionList";
import { MessageStream } from "./MessageStream";

/** Encode a workspace path to the directory name format used by ~/.claude/projects/ */
function encodePath(path: string): string {
  return path.replace(/\//g, "-");
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

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasProjectScope = !!selectedWorkspacePath;
  const projectPath = selectedWorkspacePath
    ? encodePath(selectedWorkspacePath)
    : undefined;

  // Load sessions
  const loadSessions = useCallback(async () => {
    const effectiveProjectPath = scope === "project" ? projectPath : undefined;
    try {
      let result: SessionSummary[];
      if (searchQuery.trim()) {
        result = await api.searchHistory(
          searchQuery.trim(),
          scope,
          effectiveProjectPath,
        );
      } else {
        result = await api.getHistorySessions(scope, effectiveProjectPath);
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
  }, [searchQuery, scope, projectPath, selectedFilePath]);

  // Initial load
  useEffect(() => {
    loadSessions();
  }, [scope]);

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
  }, [searchQuery]);

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

  return (
    <div className="flex h-full w-full">
      {/* Left panel — session list */}
      <div
        className="flex-shrink-0 h-full"
        style={{
          width: 280,
          borderRight: "1px solid var(--ctp-surface0)",
        }}
      >
        <SessionList
          sessions={sessions}
          selectedFilePath={selectedFilePath}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          scope={scope}
          onScopeChange={setScope}
          hasProjectScope={hasProjectScope}
          onSelectSession={selectSession}
        />
      </div>

      {/* Right panel — message stream or placeholder */}
      <div className="flex-1 h-full min-w-0">
        {selectedSummary ? (
          <MessageStream
            messages={messages}
            summary={selectedSummary}
            searchQuery={searchQuery}
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
  );
}
