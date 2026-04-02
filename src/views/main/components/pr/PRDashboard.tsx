// ============================================================
// PRDashboard — Main PR feedback dashboard.
// Port of DashboardView.swift.
// Shows active PR monitor status, start/stop controls,
// and list of draft replies as cards.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { PRDraftSummary, AssignedPR } from "../../../../shared/ipc-types";
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
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [assignedPRs, setAssignedPRs] = useState<AssignedPR[]>([]);
  const [loadingAssigned, setLoadingAssigned] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount (or workspace change), recover monitoring state from backend
  useEffect(() => {
    if (!selectedWorkspacePath) return;
    let cancelled = false;
    api.getPRMonitorStatus(selectedWorkspacePath).then((status: { monitoring: true; prNumber: number; prURL: string; owner: string; repo: string } | null) => {
      if (cancelled) return;
      if (status) {
        setMonitoring(true);
        setMonitorInfo({
          owner: status.owner,
          repo: status.repo,
          prNumber: status.prNumber,
        });
        setPrURL(status.prURL);
      }
    }).catch(() => { /* ignore — backend may not support this yet */ });
    return () => { cancelled = true; };
  }, [selectedWorkspacePath]);

  // Refresh drafts and last-poll timestamp
  const refreshDrafts = useCallback(async () => {
    if (!selectedWorkspacePath || !monitoring) return;
    try {
      const [result, poll] = await Promise.all([
        api.getPRDrafts(selectedWorkspacePath),
        api.getLastPoll(selectedWorkspacePath),
      ]);
      setDrafts(result);
      setLastPoll(poll);
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

  // Fetch assigned PRs when not monitoring
  useEffect(() => {
    if (monitoring || !selectedWorkspacePath) return;
    let cancelled = false;
    setLoadingAssigned(true);
    api.getAssignedPRs().then((prs: AssignedPR[]) => {
      if (!cancelled) setAssignedPRs(prs);
    }).catch((err: unknown) => {
      console.error("[PRDashboard] fetch assigned PRs error:", err);
    }).finally(() => {
      if (!cancelled) setLoadingAssigned(false);
    });
    return () => { cancelled = true; };
  }, [monitoring, selectedWorkspacePath]);

  const handleReviewPR = useCallback(async (pr: AssignedPR) => {
    if (!selectedWorkspacePath) return;
    setError(null);
    setStarting(true);
    try {
      await api.startPRMonitor({
        workspacePath: selectedWorkspacePath,
        prNumber: pr.number,
        prURL: pr.url,
        owner: pr.owner,
        repo: pr.repo,
      });
      setMonitoring(true);
      setMonitorInfo({ owner: pr.owner, repo: pr.repo, prNumber: pr.number });
      setPrURL(pr.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [selectedWorkspacePath]);

  const handleCheckNow = useCallback(async () => {
    if (!selectedWorkspacePath || checking) return;
    setChecking(true);
    try {
      await api.pollNow(selectedWorkspacePath);
      await refreshDrafts();
    } catch (err) {
      console.error("[PRDashboard] check now error:", err);
    } finally {
      setChecking(false);
    }
  }, [selectedWorkspacePath, checking, refreshDrafts]);

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

  const handleEditReply = useCallback(async (draftId: string, text: string) => {
    await api.updateDraftText(draftId, text);
    refreshDrafts();
  }, [refreshDrafts]);

  const handleViewDiff = useCallback((commitRef: string) => {
    // TODO: open diff viewer for commitRef
    console.log("[PRDashboard] view diff for commit:", commitRef);
  }, []);

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

        {monitoring && (
          <div className="flex items-center gap-3">
            {lastPoll && (
              <span
                className="text-xs"
                style={{ color: "var(--ctp-overlay0)" }}
              >
                Last checked: {formatRelativeTime(lastPoll)}
              </span>
            )}
            <button
              onClick={handleCheckNow}
              disabled={checking}
              className="px-3 py-1 text-xs font-medium rounded"
              style={{
                backgroundColor: "var(--ctp-surface1)",
                color: "var(--ctp-text)",
                opacity: checking ? 0.5 : 1,
              }}
            >
              {checking ? "Checking..." : "Check Now"}
            </button>
            <button
              onClick={handleStop}
              className="px-3 py-1 text-xs font-medium rounded"
              style={{
                backgroundColor: "var(--ctp-red)",
                color: "var(--ctp-base)",
              }}
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {/* Start form or content */}
      {!monitoring ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: URL input section */}
          <div className="flex flex-col items-center justify-center gap-4 px-8 w-1/2"
            style={{ borderRight: "1px solid var(--ctp-surface0)" }}
          >
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

          {/* Right: Assigned PRs list */}
          <div className="flex flex-col w-1/2 overflow-y-auto px-6 py-6">
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--ctp-subtext0)" }}
            >
              PRs Assigned to Me
            </div>
            {loadingAssigned ? (
              <div className="text-xs" style={{ color: "var(--ctp-overlay0)" }}>
                Loading...
              </div>
            ) : assignedPRs.length === 0 ? (
              <div className="text-xs" style={{ color: "var(--ctp-overlay0)" }}>
                No open PRs assigned to you.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {assignedPRs.map((pr) => (
                  <div
                    key={pr.url}
                    className="flex items-center gap-3 px-3 py-2 rounded"
                    style={{ backgroundColor: "var(--ctp-surface0)" }}
                  >
                    <span
                      className="text-xs font-medium shrink-0"
                      style={{ color: "var(--ctp-subtext0)" }}
                    >
                      {pr.owner}/{pr.repo}
                    </span>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: "var(--ctp-overlay0)" }}
                    >
                      #{pr.number}
                    </span>
                    <span
                      className="text-sm truncate flex-1"
                      style={{ color: "var(--ctp-text)" }}
                    >
                      {pr.title}
                    </span>
                    <button
                      onClick={() => handleReviewPR(pr)}
                      disabled={starting}
                      className="text-xs font-medium px-2 py-1 rounded shrink-0"
                      style={{
                        backgroundColor: "var(--ctp-blue)",
                        color: "var(--ctp-base)",
                        opacity: starting ? 0.5 : 1,
                      }}
                    >
                      Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                onEditReply={handleEditReply}
                onViewDiff={handleViewDiff}
              />
            ))}
            {completedDrafts.map((draft) => (
              <div key={draft.id} className="opacity-60">
                <DraftCard
                  draft={draft}
                  onApprove={handleApprove}
                  onDismiss={handleDismiss}
                  onViewDiff={handleViewDiff}
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

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
