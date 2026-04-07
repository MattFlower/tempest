import { useState, useEffect, useCallback } from "react";
import { WorkspaceStage } from "../../../../shared/ipc-types";
import type { WorkspaceProgressInfo } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { ProgressStageSection } from "./ProgressStageSection";

const STAGE_ORDER: WorkspaceStage[] = [
  WorkspaceStage.Merged,
  WorkspaceStage.PullRequest,
  WorkspaceStage.InDevelopment,
  WorkspaceStage.New,
];

const STAGE_LABELS: Record<WorkspaceStage, string> = {
  [WorkspaceStage.Merged]: "Merged",
  [WorkspaceStage.PullRequest]: "Pull Request",
  [WorkspaceStage.InDevelopment]: "In Development",
  [WorkspaceStage.New]: "New",
};

const POLL_INTERVAL_MS = 60_000;

export function ProgressView() {
  const [data, setData] = useState<WorkspaceProgressInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedStages, setCollapsedStages] = useState<Set<WorkspaceStage>>(
    new Set(),
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const refresh = useCallback(async (forceRefresh = false) => {
    try {
      const result = await api.getProgressData(forceRefresh);
      setData(result);
    } catch (err) {
      console.error("[ProgressView] Failed to fetch progress data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggleStage = useCallback((stage: WorkspaceStage) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }, []);

  const toggleRow = useCallback((wsPath: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(wsPath)) next.delete(wsPath);
      else next.add(wsPath);
      return next;
    });
  }, []);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh(true);
    setRefreshing(false);
  }, [refresh]);

  const handleArchived = useCallback((wsPath: string) => {
    setData((prev) => prev.filter((w) => w.workspacePath !== wsPath));
  }, []);

  // Group workspaces by stage
  const grouped = new Map<WorkspaceStage, WorkspaceProgressInfo[]>();
  for (const stage of STAGE_ORDER) {
    grouped.set(stage, []);
  }
  for (const ws of data) {
    const stage = ws.stage as WorkspaceStage;
    grouped.get(stage)?.push(ws);
  }

  if (loading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        <span className="text-sm">Loading progress data...</span>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-w-0"
      style={{ backgroundColor: "var(--ctp-base)" }}
    >
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Refresh button — top right */}
        <div className="flex justify-end mb-2">
          <button
            onClick={manualRefresh}
            disabled={refreshing}
            className="p-1.5 rounded transition-colors hover:bg-[var(--ctp-surface0)]"
            title="Refresh progress data"
            style={{ color: refreshing ? "var(--ctp-overlay0)" : "var(--ctp-overlay2)" }}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                animation: refreshing ? "spin 1s linear infinite" : "none",
              }}
            >
              <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
              <path d="M13.5 1v3.5H10" />
              <path d="M2.5 15v-3.5H6" />
            </svg>
          </button>
        </div>

        {STAGE_ORDER.map((stage) => {
          const workspaces = grouped.get(stage) ?? [];
          if (workspaces.length === 0) return null;
          return (
            <ProgressStageSection
              key={stage}
              stage={stage}
              label={STAGE_LABELS[stage]}
              workspaces={workspaces}
              collapsed={collapsedStages.has(stage)}
              expandedRows={expandedRows}
              onToggleCollapse={() => toggleStage(stage)}
              onToggleRow={toggleRow}
              onArchived={handleArchived}
              onRefresh={refresh}
            />
          );
        })}

        {data.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-2"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            <span className="text-sm">No workspaces found.</span>
            <span className="text-xs" style={{ color: "var(--ctp-overlay0)" }}>
              Create a workspace from the sidebar to get started.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
