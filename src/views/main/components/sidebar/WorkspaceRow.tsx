import type { TempestWorkspace, WorkspaceSidebarInfo, DiffStats } from "../../../../shared/ipc-types";
import { WorkspaceStatus } from "../../../../shared/ipc-types";

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
      className="flex items-center gap-1 rounded border border-[var(--ctp-surface1)] px-1.5 py-0.5 font-mono text-[10px] hover:border-[var(--ctp-surface2)]"
    >
      <span style={{ color: "var(--ctp-green)" }}>+{stats.additions}</span>
      <span style={{ color: "var(--ctp-red)" }}>-{stats.deletions}</span>
    </button>
  );
}

export function WorkspaceRow({ workspace, sidebarInfo, shortcutIndex, isSelected, onSelect, onArchive, onRefreshDiffStats }: Props) {
  const dotColor = statusDotColor[workspace.status] ?? "var(--ctp-overlay0)";
  const isIdle = workspace.status === WorkspaceStatus.Idle;
  const secondaryParts = [sidebarInfo?.bookmarkName, statusLabel(workspace)].filter(Boolean).join(" \u00B7 ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        // Context menu handled at a higher level if needed
      }}
      className={`group flex flex-col gap-0.5 rounded-md px-2 py-1.5 cursor-pointer ${
        isSelected
          ? "bg-[var(--ctp-surface0)]"
          : "hover:bg-[var(--ctp-surface0)]/50"
      }`}
    >
      {/* Line 1: branch icon + name + diff stats */}
      <div className="flex items-center gap-1.5 min-w-0">
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-[var(--ctp-overlay1)]" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 9.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm7.5-9.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM4.25 5v5.174a2.25 2.25 0 1 0 1.5 0V5A2.25 2.25 0 1 0 4.25 5Zm6.5-2.174V5a2.25 2.25 0 1 0 1.5 0V2.826a2.25 2.25 0 1 0-1.5 0Z" />
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
          style={{ backgroundColor: dotColor, opacity: isIdle ? 0.4 : 1 }}
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
