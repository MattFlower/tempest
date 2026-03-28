// Re-export workspace types from shared for convenience in view code
export type {
  SourceRepo,
  TempestWorkspace,
  WorkspaceSidebarInfo,
  DiffStats,
  Bookmark,
  AppConfig,
} from "../../../shared/ipc-types";

export { WorkspaceStatus, VCSType } from "../../../shared/ipc-types";
