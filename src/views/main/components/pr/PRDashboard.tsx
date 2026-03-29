// ============================================================
// PRDashboard — Main PR feedback dashboard.
// Port of DashboardView.swift.
// Shows active PR monitor status, start/stop controls,
// and list of draft replies as cards.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { PRDraftSummary } from "../../../../shared/ipc-types";
import { api, onPRDraftsChanged, offPRDraftsChanged } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { DraftCard } from "./DraftCard";

/** Parse a GitHub PR URL like "https://github.com/owner/repo/pull/123" */
function parsePRURL(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    prNumber: parseInt(match[3]!, 10),
  };
}

export function PRDashboard() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const [prURL, setPrURL] = useState("");
  const [monitoring, setMonitoring] = useState(false);
  const [monitorInfo, setMonitorInfo] = useState<{
    owner: string;
    repo: string;
    prNumber: number;
  } | null>(null);
  const [drafts, setDrafts] = useState<PRDraftSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refresh drafts
  const refreshDrafts = useCallback(async () => {
    if (!selectedWorkspacePath || !monitoring) return;
    try {
      const result = await api.getPRDrafts(selectedWorkspacePath);
      setDrafts(result);
    } catch (err) {
      console.error("[PRDashboard] refresh drafts error:", err);
    }
  }, [selectedWorkspacePath, monitoring]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (monitoring) {
      refreshDrafts();
      refreshTimer.current = setInterval(refreshDrafts, 5000);
    }
    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [monitoring, refreshDrafts]);

  // Listen for push notifications
  useEffect(() => {
    onPRDraftsChanged((workspacePath, newDrafts) => {
      if (workspacePath === selectedWorkspacePath) {
        setDrafts(newDrafts);
      }
    });
    return () => {
      offPRDraftsChanged();
    };
  }, [selectedWorkspacePath]);

  const handleStart = useCallback(async () => {
    if (!selectedWorkspacePath) return;
    setError(null);

    const parsed = parsePRURL(prURL.trim());
    if (!parsed) {
      setError("Invalid PR URL. Expected format: https://github.com/owner/repo/pull/123");
      return;
    }

    setStarting(true);
    try {
      await api.startPRMonitor({
        workspacePath: selectedWorkspacePath,
        prNumber: parsed.prNumber,
        prURL: prURL.trim(),
        owner: parsed.owner,
        repo: parsed.repo,
      });
      setMonitoring(true);
      setMonitorInfo(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [selectedWorkspacePath, prURL]);

  const handleStop = useCallback(async () => {
    if (!selectedWorkspacePath) return;
    try {
      await api.stopPRMonitor(selectedWorkspacePath);
    } catch (err) {
      console.error("[PRDashboard] stop error:", err);
    }
    setMonitoring(false);
    setMonitorInfo(null);
    setDrafts([]);
  }, [selectedWorkspacePath]);

  const handleApprove = useCallback(async (draftId: string) => {
    const result = await api.approveDraft(draftId);
    if (!result.success) {
      setError(`Failed to approve: ${result.error}`);
    }
    refreshDrafts();
  }, [refreshDrafts]);

  const handleDismiss = useCallback(async (draftId: string, abandon: boolean) => {
    await api.dismissDraft(draftId, abandon);
    refreshDrafts();
  }, [refreshDrafts]);

  if (!selectedWorkspacePath) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Select a workspace first</span>
      </div>
    );
  }

  const pendingDrafts = drafts.filter((d) => d.status === "pending");
  const completedDrafts = drafts.filter((d) => d.status !== "pending");

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--ctp-text)" }}
          >
            PR Review Feedback
          </span>
          {monitoring && monitorInfo && (
            <span
              className="text-xs truncate"
              style={{ color: "var(--ctp-subtext0)" }}
            >
              Monitoring PR #{monitorInfo.prNumber} in{" "}
              {monitorInfo.owner}/{monitorInfo.repo}
            </span>
          )}
        </div>

        {monitoring ? (
          <button
            onClick={handleStop}
            className="px-3 py-1 text-xs font-medium rounded"
            style={{
              backgroundColor: "var(--ctp-red)",
              color: "var(--ctp-base)",
            }}
          >
            Stop Monitoring
          </button>
        ) : null}
      </div>

      {/* Start form or content */}
      {!monitoring ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8">
          <div
            className="text-center"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            <div className="text-lg mb-1">No PR Monitored</div>
            <div className="text-xs">
              Enter a GitHub PR URL to start monitoring for review comments.
            </div>
          </div>

          <div className="flex gap-2 w-full max-w-lg">
            <input
              type="text"
              value={prURL}
              onChange={(e) => setPrURL(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStart();
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              className="flex-1 px-3 py-2 text-sm rounded outline-none"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                border: "1px solid var(--ctp-surface1)",
              }}
            />
            <button
              onClick={handleStart}
              disabled={starting || !prURL.trim()}
              className="px-4 py-2 text-sm font-medium rounded"
              style={{
                backgroundColor: starting
                  ? "var(--ctp-surface1)"
                  : "var(--ctp-blue)",
                color: "var(--ctp-base)",
                opacity: !prURL.trim() ? 0.5 : 1,
              }}
            >
              {starting ? "Starting..." : "Start Monitoring"}
            </button>
          </div>

          {error && (
            <div
              className="text-xs px-3 py-2 rounded max-w-lg w-full"
              style={{
                backgroundColor: "rgba(243, 139, 168, 0.1)",
                color: "var(--ctp-red)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      ) : drafts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          <div className="text-sm">No Drafts</div>
          <div className="text-xs opacity-60">
            Waiting for review comments...
          </div>
          {error && (
            <div
              className="text-xs px-3 py-2 rounded mt-2"
              style={{
                backgroundColor: "rgba(243, 139, 168, 0.1)",
                color: "var(--ctp-red)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-3">
            {pendingDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onApprove={handleApprove}
                onDismiss={handleDismiss}
              />
            ))}
            {completedDrafts.map((draft) => (
              <div key={draft.id} className="opacity-60">
                <DraftCard
                  draft={draft}
                  onApprove={handleApprove}
                  onDismiss={handleDismiss}
                />
              </div>
            ))}
          </div>

          {error && (
            <div
              className="text-xs px-3 py-2 rounded mt-3"
              style={{
                backgroundColor: "rgba(243, 139, 168, 0.1)",
                color: "var(--ctp-red)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
