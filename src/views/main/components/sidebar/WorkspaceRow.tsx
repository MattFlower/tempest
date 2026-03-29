import type { TempestWorkspace, WorkspaceSidebarInfo, DiffStats } from "../../../../shared/ipc-types";
import { WorkspaceStatus, ActivityState } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";

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
        // Context menu handled at a higher level if needed
      }}
      className={`group flex flex-col gap-1 rounded-md px-3 pl-4 py-2.5 cursor-pointer ${
        isSelected
          ? "bg-[var(--ctp-surface0)]"
          : "hover:bg-[var(--ctp-surface0)]/50"
      }`}
    >
      {/* Line 1: branch icon + name + diff stats */}
      <div className="flex items-center gap-1.5 min-w-0">
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-[var(--ctp-overlay1)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="13" r="1.5" />
          <circle cx="4.5" cy="3" r="1.5" />
          <circle cx="11.5" cy="3" r="1.5" />
          <path d="M4.5 4.5V7.5C4.5 9 5.5 10 8 10V11.5" />
          <path d="M11.5 4.5V7.5C11.5 9 10.5 10 8 10" />
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
