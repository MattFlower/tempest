import type { WorkspaceStage, WorkspaceProgressInfo } from "../../../../shared/ipc-types";
import { ProgressRow } from "./ProgressRow";

interface Props {
  stage: WorkspaceStage;
  label: string;
  workspaces: WorkspaceProgressInfo[];
  collapsed: boolean;
  expandedRows: Set<string>;
  onToggleCollapse: () => void;
  onToggleRow: (wsPath: string) => void;
  onArchived: (wsPath: string) => void;
  onRefresh: () => void;
}

export function ProgressStageSection({
  stage,
  label,
  workspaces,
  collapsed,
  expandedRows,
  onToggleCollapse,
  onToggleRow,
  onArchived,
  onRefresh,
}: Props) {
  return (
    <div className="mb-5">
      {/* Stage header */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 w-full pb-1.5 mb-1.5 transition-colors"
        style={{
          borderBottom: "1px solid var(--ctp-surface0)",
          color: "var(--ctp-overlay2)",
        }}
      >
        <span
          className="text-[10px] inline-block w-3 text-center transition-transform duration-200"
          style={{
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <span
          className="text-[10px] font-semibold px-1.5 rounded-full"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-subtext0)",
          }}
        >
          {workspaces.length}
        </span>
      </button>

      {/* Collapsible body */}
      <div
        className="overflow-hidden transition-all duration-200"
        style={{
          maxHeight: collapsed ? 0 : workspaces.length * 300,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? "none" : "auto",
        }}
      >
        {workspaces.map((ws) => (
          <ProgressRow
            key={ws.workspacePath}
            workspace={ws}
            expanded={expandedRows.has(ws.workspacePath)}
            onToggleExpand={() => onToggleRow(ws.workspacePath)}
            onArchived={() => onArchived(ws.workspacePath)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
