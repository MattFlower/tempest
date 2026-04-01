import type {
  DiffStats,
  TempestWorkspace,
  VCSType,
} from "../../shared/ipc-types";

export interface VCSProvider {
  readonly vcsType: VCSType;
  readonly repoPath: string;

  createWorkspace(
    name: string,
    atPath: string,
    branch?: string,
    useExistingBranch?: boolean,
  ): Promise<TempestWorkspace>;

  listWorkspaceNames(): Promise<string[]>;

  archiveWorkspace(workspace: TempestWorkspace): Promise<void>;

  bookmarkName(workspace: TempestWorkspace): Promise<string | undefined>;

  diffStats(workspace: TempestWorkspace): Promise<DiffStats>;

  listBranches(): Promise<string[]>;
}
