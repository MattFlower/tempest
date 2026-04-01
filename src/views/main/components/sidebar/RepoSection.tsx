import { useState } from "react";
import type { SourceRepo, TempestWorkspace, WorkspaceSidebarInfo } from "../../../../shared/ipc-types";
import { OverlayWrapper } from "../../state/useOverlay";
import { WorkspaceRow } from "./WorkspaceRow";

interface Props {
  repo: SourceRepo;
  workspaces: TempestWorkspace[];
  sidebarInfo: Record<string, WorkspaceSidebarInfo>;
  selectedWorkspacePath: string | null;
  showDivider: boolean;
  onSelectWorkspace: (path: string) => void;
  onArchiveWorkspace: (workspace: TempestWorkspace) => void;
  onToggleExpanded: () => void;
  onNewWorkspace: () => void;
  onRefreshWorkspaces: () => void;
  onRemoveRepo: () => void;
  onRefreshSidebarInfo: (workspacePath: string) => void;
  onOpenSettings: () => void;
}

export function RepoSection({
  repo,
  workspaces,
  sidebarInfo,
  selectedWorkspacePath,
  showDivider,
  onSelectWorkspace,
  onArchiveWorkspace,
  onToggleExpanded,
  onNewWorkspace,
  onRefreshWorkspaces,
  onRemoveRepo,
  onRefreshSidebarInfo,
  onOpenSettings,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div>
      {showDivider && <div className="h-px bg-[var(--ctp-surface0)] mx-2 my-3" />}

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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--ctp-surface0)] text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] transition-all"
          title="Repository settings"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116l.094-.318z" />
          </svg>
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <OverlayWrapper>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextMenuItem label="New Workspace..." onClick={() => { setContextMenu(null); onNewWorkspace(); }} />
            <ContextMenuItem label="Repository Settings..." onClick={() => { setContextMenu(null); onOpenSettings(); }} />
            <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />
            <ContextMenuItem label="Refresh Workspaces" onClick={() => { setContextMenu(null); onRefreshWorkspaces(); }} />
            <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />
            <ContextMenuItem label="Remove Repository" onClick={() => { setContextMenu(null); onRemoveRepo(); }} destructive />
          </div>
        </OverlayWrapper>
      )}

      {/* Workspace list */}
      {repo.isExpanded && (
        <div className="flex flex-col gap-0.5 px-1">
          {/* New workspace row */}
          <button
            onClick={onNewWorkspace}
            className="flex items-center gap-1.5 rounded-md px-2 pl-3 py-1 text-[12px] text-[var(--ctp-overlay1)] hover:bg-[var(--ctp-surface0)]/50 hover:text-[var(--ctp-text)]"
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
              onArchive={() => onArchiveWorkspace(ws)}
              onRefreshDiffStats={() => onRefreshSidebarInfo(ws.path)}
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
