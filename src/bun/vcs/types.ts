import type {
  DiffStats,
  TempestWorkspace,
  VCSType,
} from "../../shared/ipc-types";

export interface WorkspaceEntry {
  name: string;
  path: string; // Absolute path to the worktree/workspace root
}

export interface VCSProvider {
  readonly vcsType: VCSType;
  readonly repoPath: string;

  createWorkspace(
    name: string,
    atPath: string,
    branch?: string,
    useExistingBranch?: boolean,
  ): Promise<TempestWorkspace>;

  /**
   * List all workspaces/worktrees known to the VCS.
   * @param wsRoot - The Tempest workspace root directory for this repo
   *                 (used by jj to construct paths for non-default workspaces).
   */
  listWorkspaces(wsRoot: string): Promise<WorkspaceEntry[]>;

  archiveWorkspace(workspace: TempestWorkspace): Promise<void>;

  bookmarkName(workspace: TempestWorkspace): Promise<string | undefined>;

  diffStats(workspace: TempestWorkspace): Promise<DiffStats>;

  listBranches(): Promise<string[]>;
}
