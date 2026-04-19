import { WorkspaceStatus, ActivityState, BranchHealthStatus } from "../../../../shared/ipc-types";

export const branchHealthColor: Record<string, string> = {
  [BranchHealthStatus.Ok]: "var(--ctp-green)",
  [BranchHealthStatus.NeedsRebase]: "var(--ctp-yellow)",
  [BranchHealthStatus.HasConflicts]: "var(--ctp-red)",
};

export const branchHealthTooltip: Record<string, string> = {
  [BranchHealthStatus.Ok]: "Up to date with trunk",
  [BranchHealthStatus.NeedsRebase]: "Branch needs rebase onto trunk",
  [BranchHealthStatus.HasConflicts]: "Branch has conflicts",
};

export const BRANCH_HEALTH_NEUTRAL = "var(--ctp-overlay1)";

export const statusDotColor: Record<string, string> = {
  [WorkspaceStatus.Working]: "var(--ctp-green)",
  [WorkspaceStatus.NeedsInput]: "var(--ctp-red)",
  [WorkspaceStatus.Exited]: "var(--ctp-yellow)",
  [WorkspaceStatus.Error]: "var(--ctp-red)",
  [WorkspaceStatus.Idle]: "var(--ctp-overlay0)",
};

export function effectiveWorkspaceStatus(
  baseStatus: WorkspaceStatus,
  activity: ActivityState | undefined,
): WorkspaceStatus {
  if (activity === ActivityState.Working) return WorkspaceStatus.Working;
  if (activity === ActivityState.NeedsInput) return WorkspaceStatus.NeedsInput;
  if (activity === ActivityState.Idle) return WorkspaceStatus.Idle;
  return baseStatus;
}
