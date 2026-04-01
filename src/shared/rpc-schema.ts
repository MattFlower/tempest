// ============================================================
// Full typed RPC schema — the contract between Bun and Webview.
// Every request and message between processes is defined here.
// ============================================================

import type {
  AppConfig,
  BinaryStatus,
  Bookmark,
  DiffFile,
  HookEvent,
  LatencyStats,
  PaneNodeState,
  RepoSettings,
  SessionMessage,
  SessionState,
  SessionSummary,
  SourceRepo,
  TempestWorkspace,
  UsageResponse,
  VCSType,
  WorkspaceSidebarInfo,
} from "./ipc-types";

import type {
  DiffScope,
  FileAIContext,
  FileChangeTimeline,
  PRDraftSummary,
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
      workspaceName?: string;
    };
    response: { command: string[]; settingsPath?: string };
  };
  buildShellCommand: {
    params: { workspacePath: string };
    response: { command: string[] };
  };
  buildEditorCommand: {
    params: { filePath: string; lineNumber?: number };
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
  getBranches: {
    params: { repoId: string };
    response: string[];
  };
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

  // Repo settings
  getRepoSettings: {
    params: { repoPath: string };
    response: RepoSettings;
  };
  saveRepoSettings: {
    params: { repoPath: string; settings: RepoSettings };
    response: void;
  };
  testPrepareScript: {
    params: { repoPath: string; script: string };
    response: { exitCode: number; output: string };
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
  updateBookmark: {
    params: { repoPath: string; bookmarkId: string; label: string; url?: string };
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

  // Onboarding
  checkBinaries: {
    params: void;
    response: BinaryStatus;
  };
  setWorkspaceRoot: {
    params: { path: string };
    response: void;
  };
  browseDirectory: {
    params: { startingFolder?: string };
    response: { path: string | null };
  };

  // Usage tracking
  getUsageData: {
    params: { since?: string };
    response: UsageResponse;
  };

  // History
  getHistorySessions: {
    params: { scope: "all" | "project"; projectPath?: string };
    response: SessionSummary[];
  };
  searchHistory: {
    params: { query: string; scope: "all" | "project"; projectPath?: string };
    response: SessionSummary[];
  };
  getSessionMessages: {
    params: { sessionFilePath: string };
    response: SessionMessage[];
  };
  isHistorySearchAvailable: {
    params: void;
    response: boolean;
  };

  // Markdown
  readMarkdownFile: {
    params: { filePath: string };
    response: { content: string; fileName: string };
  };
  watchMarkdownFile: {
    params: { filePath: string };
    response: void;
  };
  unwatchMarkdownFile: {
    params: { filePath: string };
    response: void;
  };

  // File operations (for Monaco editor)
  readFileForEditor: {
    params: { filePath: string };
    response: { content: string; language: string };
  };
  writeFileForEditor: {
    params: { filePath: string; content: string };
    response: void;
  };
  resolveModulePath: {
    params: { specifier: string; fromFilePath: string };
    response: { resolvedPath: string | null };
  };

  // Diff viewer
  getDiff: {
    params: { workspacePath: string; scope: DiffScope; contextLines?: number; commitRef?: string };
    response: { raw: string; files: DiffFile[] };
  };
  getAIContextForFile: {
    params: { filePath: string; projectPath?: string };
    response: FileAIContext | null;
  };
  getAITimelineForFile: {
    params: { filePath: string; projectPath?: string };
    response: FileChangeTimeline | null;
  };

  // PR URL lookup
  lookupPRUrl: {
    params: { workspacePath: string };
    response: { url: string } | { error: string };
  };

  // PR Feedback
  getPRMonitorStatus: {
    params: { workspacePath: string };
    response: { monitoring: true; prNumber: number; prURL: string; owner: string; repo: string } | null;
  };
  startPRMonitor: {
    params: { workspacePath: string; prNumber: number; prURL: string; owner: string; repo: string };
    response: void;
  };
  stopPRMonitor: {
    params: { workspacePath: string };
    response: void;
  };
  getPRDrafts: {
    params: { workspacePath: string };
    response: PRDraftSummary[];
  };
  approveDraft: {
    params: { draftId: string };
    response: { success: boolean; error?: string };
  };
  dismissDraft: {
    params: { draftId: string; abandon: boolean };
    response: void;
  };
  pollNow: {
    params: { workspacePath: string };
    response: void;
  };
  getLastPoll: {
    params: { workspacePath: string };
    response: string | null;
  };
  updateDraftText: {
    params: { draftId: string; text: string };
    response: void;
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
  workspaceActivityChanged: { workspacePath: string; activityState: number | null; pid: number };
  workspacesChanged: { repoId: string; workspaces: TempestWorkspace[] };
  sidebarInfoUpdated: { workspacePath: string; info: WorkspaceSidebarInfo };
  configChanged: AppConfig;
  menuAction: { action: string };
  markdownFileChanged: { filePath: string; content: string; deleted?: boolean };
  prDraftsChanged: { workspacePath: string; drafts: PRDraftSummary[] };
}
