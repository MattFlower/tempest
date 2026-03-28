// ============================================================
// Full typed RPC schema — the contract between Bun and Webview.
// Every request and message between processes is defined here.
// ============================================================

import type {
  AppConfig,
  Bookmark,
  HookEvent,
  LatencyStats,
  PaneNodeState,
  SessionState,
  SourceRepo,
  TempestWorkspace,
  VCSType,
  WorkspaceSidebarInfo,
} from "./ipc-types";

// --- Bun-side handlers (Webview calls these) ---

export interface BunRequests {
  // Terminal lifecycle
  createTerminal: {
    params: {
      id: string;
      command: string[];
      cwd: string;
      env?: Record<string, string>;
      cols: number;
      rows: number;
    };
    response: { success: boolean; error?: string };
  };
  resizeTerminal: {
    params: { id: string; cols: number; rows: number };
    response: void;
  };
  killTerminal: {
    params: { id: string };
    response: void;
  };

  // Session commands
  buildClaudeCommand: {
    params: {
      workspacePath: string;
      resume: boolean;
      sessionId?: string;
      withHooks: boolean;
      withChannel?: boolean;
    };
    response: { command: string[]; settingsPath?: string };
  };
  buildShellCommand: {
    params: { workspacePath: string };
    response: { command: string[] };
  };

  // Repos
  getRepos: {
    params: void;
    response: SourceRepo[];
  };
  addRepo: {
    params: { path: string };
    response: { success: boolean; error?: string };
  };
  removeRepo: {
    params: { repoId: string };
    response: void;
  };

  // Workspaces
  getWorkspaces: {
    params: { repoId: string };
    response: TempestWorkspace[];
  };
  createWorkspace: {
    params: {
      repoId: string;
      name: string;
      branch?: string;
      useExistingBranch?: boolean;
    };
    response: { success: boolean; error?: string; workspace?: TempestWorkspace };
  };
  archiveWorkspace: {
    params: { workspaceId: string };
    response: { success: boolean; error?: string };
  };
  refreshWorkspaces: {
    params: { repoId: string };
    response: TempestWorkspace[];
  };

  // Sidebar info
  getSidebarInfo: {
    params: { workspacePath: string };
    response: WorkspaceSidebarInfo;
  };
  getVCSType: {
    params: { repoPath: string };
    response: VCSType;
  };

  // Config
  getConfig: {
    params: void;
    response: AppConfig;
  };
  saveConfig: {
    params: AppConfig;
    response: void;
  };

  // Bookmarks
  getBookmarks: {
    params: { repoPath: string };
    response: Bookmark[];
  };
  addBookmark: {
    params: { repoPath: string; url: string; label: string };
    response: void;
  };
  removeBookmark: {
    params: { repoPath: string; bookmarkId: string };
    response: void;
  };

  // Session state persistence
  loadSessionState: {
    params: void;
    response: SessionState | null;
  };
  savePaneState: {
    params: { workspacePath: string; paneTree: PaneNodeState };
    response: void;
  };

  // File operations (for command palette)
  listFiles: {
    params: { workspacePath: string };
    response: string[];
  };
}

// --- Bun-side messages (Webview fires these, no response) ---

export interface BunMessages {
  writeToTerminal: { id: string; data: string };
  paneTreeChanged: { workspacePath: string; tree: PaneNodeState };
  saveLatencyStats: { id: string; stats: LatencyStats };
}

// --- Webview-side messages (Bun pushes these, no response) ---

export interface WebviewMessages {
  terminalOutput: { id: string; data: string; seq: number };
  terminalExit: { id: string; exitCode: number };
  hookEvent: HookEvent;
  workspacesChanged: { repoId: string; workspaces: TempestWorkspace[] };
  sidebarInfoUpdated: { workspacePath: string; info: WorkspaceSidebarInfo };
  configChanged: AppConfig;
  menuAction: { action: string };
}
