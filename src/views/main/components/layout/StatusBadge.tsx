import { WorkspaceStatus } from "../../../../shared/ipc-types";

const statusConfig: Record<WorkspaceStatus, { label: string; color: string }> = {
  [WorkspaceStatus.Working]: { label: "WORKING", color: "var(--ctp-green)" },
  [WorkspaceStatus.NeedsInput]: { label: "NEEDS INPUT", color: "var(--ctp-red)" },
  [WorkspaceStatus.Exited]: { label: "EXITED", color: "var(--ctp-yellow)" },
  [WorkspaceStatus.Error]: { label: "ERROR", color: "var(--ctp-red)" },
  [WorkspaceStatus.Idle]: { label: "IDLE", color: "var(--ctp-overlay0)" },
};

interface StatusBadgeProps {
  status: WorkspaceStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, color } = statusConfig[status];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}
