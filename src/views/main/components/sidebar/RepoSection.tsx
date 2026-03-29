import { useState } from "react";
import type { SourceRepo, TempestWorkspace, WorkspaceSidebarInfo } from "../../../../shared/ipc-types";
import { WorkspaceRow } from "./WorkspaceRow";
import { api } from "../../state/rpc-client";

interface Props {
  repo: SourceRepo;
  workspaces: TempestWorkspace[];
  sidebarInfo: Record<string, WorkspaceSidebarInfo>;
  selectedWorkspacePath: string | null;
  showDivider: boolean;
  onSelectWorkspace: (path: string) => void;
  onToggleExpanded: () => void;
  onNewWorkspace: () => void;
  onRefreshWorkspaces: () => void;
  onRemoveRepo: () => void;
}

export function RepoSection({
  repo,
  workspaces,
  sidebarInfo,
  selectedWorkspacePath,
  showDivider,
  onSelectWorkspace,
  onToggleExpanded,
  onNewWorkspace,
  onRefreshWorkspaces,
  onRemoveRepo,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div>
      {showDivider && <div className="h-px bg-[var(--ctp-surface0)] mx-2 my-1" />}

      {/* Repo header */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 group"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
        >
          <svg
            className="w-3 h-3 flex-shrink-0 text-[var(--ctp-overlay1)] transition-transform duration-150"
            style={{ transform: repo.isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6.427 4.427l3.396 3.396a.25.25 0 0 1 0 .354l-3.396 3.396A.25.25 0 0 1 6 11.396V4.604a.25.25 0 0 1 .427-.177Z" />
          </svg>
          <span className="truncate text-[12px] font-semibold uppercase tracking-wider text-[var(--ctp-text)]">
            {repo.name}
          </span>
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextMenuItem label="New Workspace..." onClick={() => { setContextMenu(null); onNewWorkspace(); }} />
            <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />
            <ContextMenuItem label="Refresh Workspaces" onClick={() => { setContextMenu(null); onRefreshWorkspaces(); }} />
            <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />
            <ContextMenuItem label="Remove Repository" onClick={() => { setContextMenu(null); onRemoveRepo(); }} destructive />
          </div>
        </>
      )}

      {/* Workspace list */}
      {repo.isExpanded && (
        <div className="flex flex-col gap-0.5 px-1">
          {/* New workspace row */}
          <button
            onClick={onNewWorkspace}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--ctp-overlay1)] hover:bg-[var(--ctp-surface0)]/50 hover:text-[var(--ctp-text)]"
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.25 1v6.25H1v1.5h6.25V15h1.5V8.75H15v-1.5H8.75V1h-1.5Z" />
            </svg>
            New workspace
          </button>

          {workspaces.map((ws, i) => (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              sidebarInfo={sidebarInfo[ws.path]}
              shortcutIndex={i < 9 ? i + 1 : undefined}
              isSelected={ws.path === selectedWorkspacePath}
              onSelect={() => onSelectWorkspace(ws.path)}
              onArchive={() => api.archiveWorkspace(ws.id)}
              onRefreshDiffStats={() => api.getSidebarInfo(ws.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--ctp-surface1)] ${
        destructive ? "text-[var(--ctp-red)]" : "text-[var(--ctp-text)]"
      }`}
    >
      {label}
    </button>
  );
}
