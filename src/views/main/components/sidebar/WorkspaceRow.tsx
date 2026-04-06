import { useState } from "react";
import type { TempestWorkspace, WorkspaceSidebarInfo, DiffStats } from "../../../../shared/ipc-types";
import { WorkspaceStatus, ActivityState, BranchHealthStatus } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";
import { OverlayWrapper } from "../../state/useOverlay";

interface Props {
  workspace: TempestWorkspace;
  sidebarInfo?: WorkspaceSidebarInfo;
  shortcutIndex?: number;
  isSelected: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onRefreshDiffStats: () => void;
}

const statusDotColor: Record<string, string> = {
  [WorkspaceStatus.Working]: "var(--ctp-green)",
  [WorkspaceStatus.NeedsInput]: "var(--ctp-red)",
  [WorkspaceStatus.Exited]: "var(--ctp-yellow)",
  [WorkspaceStatus.Error]: "var(--ctp-red)",
  [WorkspaceStatus.Idle]: "var(--ctp-overlay0)",
};

const branchHealthColor: Record<string, string> = {
  [BranchHealthStatus.Ok]: "var(--ctp-green)",
  [BranchHealthStatus.NeedsRebase]: "var(--ctp-yellow)",
  [BranchHealthStatus.HasConflicts]: "var(--ctp-red)",
};

const branchHealthTooltip: Record<string, string> = {
  [BranchHealthStatus.Ok]: "Up to date with trunk",
  [BranchHealthStatus.NeedsRebase]: "Branch needs rebase onto trunk",
  [BranchHealthStatus.HasConflicts]: "Branch has conflicts",
};

function statusLabel(workspace: TempestWorkspace): string {
  switch (workspace.status) {
    case WorkspaceStatus.Working: return "Working...";
    case WorkspaceStatus.NeedsInput: return "Needs input";
    case WorkspaceStatus.Exited: return "Exited";
    case WorkspaceStatus.Error: return workspace.errorMessage ?? "Error";
    case WorkspaceStatus.Idle: return "Idle";
  }
}

function DiffStatsPill({ stats, onRefresh }: { stats: DiffStats; onRefresh: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onRefresh(); }}
      className="flex items-center font-mono"
      style={{
        gap: "6px",
        borderRadius: "6px",
        border: "1px solid var(--ctp-overlay1)",
        padding: "1px 6px",
        fontSize: "10px",
      }}
    >
      <span style={{ color: "var(--ctp-green)" }}>+{stats.additions}</span>
      <span style={{ color: "var(--ctp-red)" }}>-{stats.deletions}</span>
    </button>
  );
}

export function WorkspaceRow({ workspace, sidebarInfo, shortcutIndex, isSelected, onSelect, onArchive, onRefreshDiffStats }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Hook-driven activity state overrides the workspace status for display
  const activity = useStore((s) => s.workspaceActivity[workspace.path]);

  let effectiveStatus = workspace.status;
  if (activity === ActivityState.Working) effectiveStatus = WorkspaceStatus.Working;
  else if (activity === ActivityState.NeedsInput) effectiveStatus = WorkspaceStatus.NeedsInput;
  else if (activity === ActivityState.Idle) effectiveStatus = WorkspaceStatus.Idle;

  const dotColor = statusDotColor[effectiveStatus] ?? "var(--ctp-overlay0)";
  const isIdle = effectiveStatus === WorkspaceStatus.Idle;
  const secondaryParts = [sidebarInfo?.bookmarkName, statusLabel({ ...workspace, status: effectiveStatus })].filter(Boolean).join(" \u00B7 ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className={`group flex flex-col gap-1 rounded-md px-3 pl-4 py-2.5 cursor-pointer ${
        isSelected
          ? "bg-[var(--ctp-surface0)]"
          : "hover:bg-[var(--ctp-surface0)]/50"
      }`}
    >
      {/* Context menu */}
      {contextMenu && (
        <OverlayWrapper>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { setContextMenu(null); onRefreshDiffStats(); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)]"
            >
              Refresh
            </button>
            {workspace.name !== "default" && (
              <>
                <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />
                <button
                  onClick={() => { setContextMenu(null); onArchive(); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--ctp-red)] hover:bg-[var(--ctp-surface1)]"
                >
                  Archive Workspace
                </button>
              </>
            )}
          </div>
        </OverlayWrapper>
      )}
      {/* Line 1: branch icon + name + diff stats */}
      <div className="flex items-center gap-1.5 min-w-0">
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          style={{ color: sidebarInfo?.branchHealth ? branchHealthColor[sidebarInfo.branchHealth] : "var(--ctp-overlay1)" }}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>{sidebarInfo?.branchHealth ? branchHealthTooltip[sidebarInfo.branchHealth] : ""}</title>
          <circle cx="5" cy="3.5" r="1.5" />
          <circle cx="5" cy="12.5" r="1.5" />
          <circle cx="11" cy="6" r="1.5" />
          <path d="M5 5v6" />
          <path d="M9.5 6C8 6 5 6.5 5 8.5" />
        </svg>
        <span className="truncate text-[13px] font-semibold text-[var(--ctp-text)]">
          {workspace.name}
        </span>
        <span className="flex-1" />
        {sidebarInfo?.diffStats && (sidebarInfo.diffStats.additions > 0 || sidebarInfo.diffStats.deletions > 0) && (
          <DiffStatsPill stats={sidebarInfo.diffStats} onRefresh={onRefreshDiffStats} />
        )}
      </div>

      {/* Line 2: status dot + secondary info + shortcut */}
      <div className="flex items-center gap-1 pl-5 min-w-0">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor, opacity: isIdle ? 0.3 : 1 }}
        />
        <span className="truncate text-[11px] text-[var(--ctp-overlay1)]">
          {secondaryParts}
        </span>
        <span className="flex-1" />
        {shortcutIndex != null && (
          <span className="text-[10px] text-[var(--ctp-overlay0)]">
            ⌘{shortcutIndex}
          </span>
        )}
      </div>
    </div>
  );
}
