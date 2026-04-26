// ============================================================
// Full typed RPC schema — the contract between Bun and Webview.
// Every request and message between processes is defined here.
// ============================================================

import type {
  ActivityState,
  AppConfig,
  BinaryStatus,
  Bookmark,
  CustomScript,
  DirEntry,
  FileTreeSessionState,
  FindInFilesResult,
  HookEvent,
  HttpServerConfig,
  JJBookmark,
  JJChangedFile,
  JJLogResult,
  LatencyStats,
  NetworkInterface,
  PaneNodeState,
  RepoSettings,
  SessionMessage,
  SessionState,
  SessionSummary,
  SourceRepo,
  TempestWorkspace,
  UsageResponse,
  VCSType,
  VCSStatusResult,
  VCSCommitResult,
  VCSFileDiffResult,
  WorkspaceSidebarInfo,
} from "./ipc-types";

import type {
  AssignedPR,
  DiffScope,
  FileAIContext,
  FileChangeTimeline,
  GitBranchListResult,
  GitCommitLogResult,
  GitOpResult,
  GitScopedFilesResult,
  OpenPRState,
  PRDraftSummary,
  PRDetailInfo,
  WorkspaceProgressInfo,
  LspCodeAction,
  LspCodeActionContext,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHoverResult,
  LspInlayHint,
  LspLocation,
  LspMemorySample,
  LspPrepareRenameResult,
  LspRange,
  LspServerState,
  LspSignatureHelp,
  LspWorkspaceEdit,
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

  // Session ID lookup (PID → Claude session)
  lookupTerminalSessionId: {
    params: { terminalId: string; workspacePath: string };
    response: { sessionId: string | null };
  };
  // Plan file lookup (session → plan)
  getSessionPlanPath: {
    params: { sessionId: string; workspacePath: string };
    response: { planPath: string | null };
  };
  // Session commands
  buildClaudeCommand: {
    params: {
      workspacePath: string;
      resume: boolean;
      sessionId?: string;
      withHooks: boolean;
      withChannel?: boolean;
      withMcp?: boolean;
      mcpPort?: number;
      workspaceName?: string;
      planMode?: boolean;
    };
    response: { command: string[]; settingsPath?: string };
  };
  buildShellCommand: {
    params: { workspacePath: string };
    response: { command: string[] };
  };
  buildPiCommand: {
    params: { workspacePath: string; sessionPath?: string };
    response: { command: string[] };
  };
  buildCodexCommand: {
    params: { workspacePath: string; sessionId?: string };
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
  cloneRepo: {
    params: { vcsType: VCSType; url: string; localPath: string; colocate?: boolean };
    response: { success: boolean; error?: string };
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
  renameWorkspace: {
    params: { workspaceId: string; newName: string };
    response: {
      success: boolean;
      error?: string;
      workspace?: TempestWorkspace;
      oldPath?: string;
      newPath?: string;
    };
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

  // Pi env vars (secrets stored in macOS Keychain)
  listPiEnvVarNames: {
    params: void;
    response: string[];
  };
  setPiEnvVar: {
    params: { name: string; value: string };
    response: { success: boolean; error?: string };
  };
  deletePiEnvVar: {
    params: { name: string };
    response: { success: boolean; error?: string };
  };

  // Codex env vars (secrets stored in macOS Keychain)
  listCodexEnvVarNames: {
    params: void;
    response: string[];
  };
  setCodexEnvVar: {
    params: { name: string; value: string };
    response: { success: boolean; error?: string };
  };
  deleteCodexEnvVar: {
    params: { name: string };
    response: { success: boolean; error?: string };
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
  testArchiveScript: {
    params: { repoPath: string; script: string };
    response: { exitCode: number; output: string };
  };

  // Custom scripts
  runCustomScript: {
    params: {
      repoPath: string;
      workspacePath: string;
      workspaceName: string;
      script?: string;
      scriptPath?: string;
      paramValues?: Record<string, string>;
    };
    response: { runId: string };
  };
  /** Resolve the command, cwd, and env for a script without spawning. Used
   *  by the Run pane to hand the launch off to the shared PTY
   *  infrastructure instead of the pipe-based runCustomScript path. */
  resolveScriptLaunch: {
    params: {
      repoPath: string;
      workspacePath: string;
      workspaceName: string;
      script?: string;
      scriptPath?: string;
      paramValues?: Record<string, string>;
    };
    response: {
      command: string[];
      cwd: string;
      env: Record<string, string>;
    };
  };
  getPackageScripts: {
    params: { workspacePath: string };
    response: { scripts: Array<{ name: string; command: string }> };
  };
  getMavenScripts: {
    params: { workspacePath: string };
    response: { scripts: Array<{ name: string; command: string }> };
  };
  browseFile: {
    params: { startingFolder?: string };
    response: { path: string | null };
  };
  getRemoteRepos: {
    params: { repoPath: string };
    response: string[];
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

  // Activity state (hook-driven)
  getActivityState: {
    params: void;
    response: Record<string, ActivityState>;
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
  setRepoExpanded: {
    params: { repoId: string; isExpanded: boolean };
    response: void;
  };
  saveFileTreeState: {
    params: FileTreeSessionState;
    response: void;
  };

  // File operations (for command palette)
  listFiles: {
    params: { workspacePath: string };
    response: string[];
  };
  getRecentFiles: {
    params: { workspacePath: string };
    response: string[];
  };
  notifyFileOpened: {
    params: { workspacePath: string; filePath: string };
    response: void;
  };
  browsePath: {
    params: { query: string; workspacePath: string };
    response: {
      kind: "file" | "directory" | "not_found" | "error";
      resolvedPath: string;
      entries?: string[];
      error?: string;
    };
  };
  findInFiles: {
    params: {
      workspacePath: string;
      query: string;
      isRegex: boolean;
      caseSensitive: boolean;
      maxResults?: number;
    };
    response: FindInFilesResult;
  };

  // File tree
  listDir: {
    params: { dirPath: string; workspacePath?: string };
    response: {
      ok: boolean;
      entries?: DirEntry[];
      error?: string;
      errorKind?: "not_found" | "permission" | "not_a_directory" | "other";
    };
  };
  watchDirectoryTree: {
    params: { workspacePath: string };
    response: { ok: boolean; errorKind?: "not_found" | "other" };
  };
  unwatchDirectoryTree: {
    params: { workspacePath: string };
    response: void;
  };
  unwatchAllDirectoryTrees: {
    params: void;
    response: void;
  };
  revealInFinder: {
    params: { path: string };
    response: void;
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
    params: {
      scope: "all" | "project";
      workspacePath?: string;
      provider?: "claude" | "pi" | "codex";
    };
    response: SessionSummary[];
  };
  searchHistory: {
    params: {
      query: string;
      scope: "all" | "project";
      workspacePath?: string;
      provider?: "claude" | "pi" | "codex";
    };
    response: SessionSummary[];
  };
  getSessionMessages: {
    params: { sessionFilePath: string };
    response: SessionMessage[];
  };
  isHistorySearchAvailable: {
    params: { provider?: "claude" | "pi" | "codex" };
    response: boolean;
  };
  resolveCodexSessionId: {
    params: { sessionFilePath: string };
    response: { codexSessionId: string | null };
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

  // AI Context
  getAIContextForFile: {
    params: { filePath: string; projectPath?: string };
    response: FileAIContext | null;
  };
  getAITimelineForFile: {
    params: { filePath: string; projectPath?: string };
    response: FileChangeTimeline | null;
  };

  // Repo URL (GitHub)
  getRepoGitHubUrl: {
    params: { workspacePath: string };
    response: { url: string } | { error: string };
  };

  // PR URL lookup
  lookupPRUrl: {
    params: { workspacePath: string };
    response: { url: string } | { error: string };
  };

  // Open PR — push and create a draft PR
  getDefaultPRTitleBody: {
    params: { workspacePath: string };
    response: { title: string; body: string; bookmarkName?: string } | { error: string };
  };
  openPR: {
    params: {
      workspacePath: string;
      bookmarkName?: string;
      title: string;
      body: string;
      draft?: boolean;
    };
    response: { prURL: string } | { error: string };
  };
  updatePR: {
    params: { workspacePath: string };
    response: { success: boolean; error?: string };
  };
  getOpenPRState: {
    params: { workspacePath: string };
    response: OpenPRState | null;
  };
  setOpenPRState: {
    params: { workspacePath: string; prState: OpenPRState | null };
    response: void;
  };

  // PR Review — create a workspace for reviewing a PR
  startPRReview: {
    params: { repoId: string; prNumber: number };
    response: {
      success: boolean;
      error?: string;
      workspace?: TempestWorkspace;
      prUrl?: string;
    };
  };

  // Assigned PRs
  getAssignedPRs: {
    params: void;
    response: AssignedPR[];
  };
  refreshAssignedPRs: {
    params: void;
    response: AssignedPR[];
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

  // --- Progress View ---
  getProgressData: {
    params: { forceRefresh?: boolean };
    response: WorkspaceProgressInfo[];
  };
  getPRDetail: {
    params: { repoPath: string; branch: string };
    response: PRDetailInfo | null;
  };
  notifyWorkspaceOpened: {
    params: { workspacePath: string };
    response: void;
  };

  // --- VCS Commit View ---
  getVCSStatus: {
    params: { workspacePath: string };
    response: VCSStatusResult;
  };
  vcsStageFiles: {
    params: { workspacePath: string; paths: string[] };
    response: void;
  };
  vcsUnstageFiles: {
    params: { workspacePath: string; paths: string[] };
    response: void;
  };
  vcsStageAll: {
    params: { workspacePath: string };
    response: void;
  };
  vcsUnstageAll: {
    params: { workspacePath: string };
    response: void;
  };
  vcsRevertFiles: {
    params: { workspacePath: string; paths: string[] };
    response: { success: boolean; error?: string };
  };
  vcsCommit: {
    params: { workspacePath: string; message: string; amend: boolean };
    response: VCSCommitResult;
  };
  vcsPush: {
    params: { workspacePath: string };
    response: { success: boolean; error?: string };
  };
  vcsGetFileDiff: {
    params: { workspacePath: string; filePath: string; staged: boolean };
    response: VCSFileDiffResult;
  };

  // --- Git Commit/Scope Selection ---
  gitGetRecentCommits: {
    params: { workspacePath: string; count?: number };
    response: GitCommitLogResult;
  };
  gitGetScopedFiles: {
    params: { workspacePath: string; scope: DiffScope; commitRef?: string };
    response: GitScopedFilesResult;
  };
  gitGetScopedFileDiff: {
    params: { workspacePath: string; scope: DiffScope; filePath: string; commitRef?: string };
    response: VCSFileDiffResult;
  };

  // --- Git Branch / Remote Operations ---
  gitListBranchesAndRemotes: {
    params: { workspacePath: string };
    response: GitBranchListResult;
  };
  gitPull: {
    params: { workspacePath: string };
    response: GitOpResult;
  };
  gitFetchAll: {
    params: { workspacePath: string };
    response: GitOpResult;
  };
  gitPushBranch: {
    params: { workspacePath: string; branch: string; remote: string };
    response: GitOpResult;
  };
  gitMergeBranch: {
    params: { workspacePath: string; branch: string };
    response: GitOpResult;
  };
  gitRebaseOnto: {
    params: { workspacePath: string; branch: string };
    response: GitOpResult;
  };

  // --- JJ (Jujutsu) VCS View ---
  jjLog: {
    params: { workspacePath: string; revset?: string };
    response: JJLogResult;
  };
  jjNew: {
    params: { workspacePath: string; revisions?: string[] };
    response: { success: boolean; error?: string };
  };
  jjFetch: {
    params: { workspacePath: string; remote?: string; allRemotes?: boolean };
    response: { success: boolean; error?: string };
  };
  jjPush: {
    params: { workspacePath: string; bookmark?: string; allTracked?: boolean };
    response: { success: boolean; error?: string };
  };
  jjUndo: {
    params: { workspacePath: string };
    response: { success: boolean; error?: string };
  };
  jjDescribe: {
    params: { workspacePath: string; revision: string; description: string };
    response: { success: boolean; error?: string };
  };
  jjAbandon: {
    params: { workspacePath: string; revision: string };
    response: { success: boolean; error?: string };
  };
  jjGetChangedFiles: {
    params: { workspacePath: string; revision: string };
    response: JJChangedFile[];
  };
  jjGetFileDiff: {
    params: { workspacePath: string; revision: string; filePath: string };
    response: VCSFileDiffResult;
  };
  jjGetBookmarks: {
    params: { workspacePath: string };
    response: JJBookmark[];
  };
  jjEdit: {
    params: { workspacePath: string; revision: string };
    response: { success: boolean; error?: string };
  };
  jjBookmarkSet: {
    params: { workspacePath: string; revision: string; name: string; track: boolean };
    response: { success: boolean; error?: string };
  };
  jjRebase: {
    params: { workspacePath: string; revision: string; destination: string };
    response: { success: boolean; error?: string };
  };
  jjGetRestorePreview: {
    params: { workspacePath: string; targetRevision: string; sourceRevision: string; filePath: string };
    response: VCSFileDiffResult;
  };
  jjRestore: {
    params: { workspacePath: string; targetRevision: string; sourceRevision: string; filePath: string };
    response: { success: boolean; error?: string };
  };
  jjGetRangeChangedFiles: {
    params: { workspacePath: string; fromRevision: string; toRevision: string };
    response: JJChangedFile[];
  };
  jjGetRangeFileDiff: {
    params: { workspacePath: string; fromRevision: string; toRevision: string; filePath: string };
    response: VCSFileDiffResult;
  };

  // --- Open In (external editors) ---
  getInstalledEditors: {
    params: void;
    response: Array<{ id: string; name: string; category: "editor" | "terminal" | "file-manager" }>;
  };
  openInEditor: {
    params: { editorId: string; directory: string };
    response: { terminalCommand: string[] | null };
  };

  // --- Browser DNS ---
  resolveDns: {
    params: { hostname: string };
    response: { ok: boolean; error?: string };
  };

  // --- HTTP Remote Control Server ---
  startHttpServer: {
    params: HttpServerConfig;
    response: { port: number; hostname: string; token: string; error?: string };
  };
  stopHttpServer: {
    params: void;
    response: void;
  };
  getHttpServerStatus: {
    params: void;
    response: { running: boolean; port?: number; hostname?: string; token?: string; error?: string };
  };
  getNetworkInterfaces: {
    params: void;
    response: NetworkInterface[];
  };
  consumePendingPrompt: {
    params: { workspacePath: string };
    response: { prompt: string | null; planMode: boolean | null };
  };

  // LSP — see src/bun/lsp/. The bridge sits between Monaco's provider API
  // (webview) and stdio JSON-RPC language servers (Bun).
  lspListServers: {
    params: void;
    response: { servers: LspServerState[] };
  };
  lspRestartServer: {
    params: { serverId: string };
    response: { ok: boolean; error?: string };
  };
  lspStopServer: {
    params: { serverId: string };
    response: { ok: boolean };
  };
  lspGetServerLog: {
    params: { serverId: string };
    response: { lines: string[] };
  };
  lspMemoryWatchStart: {
    params: void;
    response: { samples: LspMemorySample[] };
  };
  lspMemoryWatchStop: {
    params: void;
    response: void;
  };
  lspDidOpen: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      version: number;
      text: string;
    };
    response: void;
  };
  lspDidChange: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      version: number;
      text: string;
    };
    response: void;
  };
  lspDidClose: {
    params: { workspacePath: string; uri: string; languageId: string };
    response: void;
  };
  lspHover: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;       // 0-based (LSP convention)
      character: number;  // 0-based, UTF-16 code units
    };
    response: { result: LspHoverResult | null };
  };
  lspDefinition: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
    };
    response: { locations: LspLocation[] };
  };
  lspCompletion: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
      /** Trigger character that fired the completion (`.`, `:`, ...) or
       *  null/undefined when triggered by typing or invocation. */
      triggerCharacter?: string;
    };
    response: { result: LspCompletionList | null };
  };
  lspReferences: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
      /** Whether to include the symbol's own declaration in results.
       *  Monaco's "Find All References" includes it; "Go to References"
       *  typically does too. */
      includeDeclaration: boolean;
    };
    response: { locations: LspLocation[] };
  };
  lspDocumentSymbols: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
    };
    response: { symbols: LspDocumentSymbol[] };
  };
  lspPrepareRename: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
    };
    response: { result: LspPrepareRenameResult | null };
  };
  lspRename: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
      newName: string;
    };
    response: { edit: LspWorkspaceEdit | null };
  };
  lspSignatureHelp: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      line: number;
      character: number;
      /** Trigger character that fired the signature help (`(`, `,`) or
       *  null/undefined when invoked manually. */
      triggerCharacter?: string;
      /** Whether this is a re-trigger for an active signature help (e.g.
       *  user typed another character while the popup was already open). */
      isRetrigger: boolean;
    };
    response: { result: LspSignatureHelp | null };
  };
  lspInlayHints: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      /** Visible range Monaco wants hints for. We forward as-is so the
       *  server can return only hints inside the viewport. */
      range: LspRange;
    };
    response: { hints: LspInlayHint[] };
  };
  lspCodeActions: {
    params: {
      workspacePath: string;
      uri: string;
      languageId: string;
      range: LspRange;
      context: LspCodeActionContext;
    };
    response: { actions: LspCodeAction[] };
  };
  lspExecuteCommand: {
    params: {
      workspacePath: string;
      languageId: string;
      command: string;
      arguments?: unknown[];
    };
    response: {
      ok: boolean;
      /** Some commands return a workspace edit (e.g. tsserver's "convert
       *  to async function"). When set, the webview applies it the same
       *  way it applies a rename's edit. */
      edit: LspWorkspaceEdit | null;
    };
  };
}

// --- Bun-side messages (Webview fires these, no response) ---

export interface BunMessages {
  writeToTerminal: { id: string; data: string };
  clipboardWrite: { text: string };
  showNotification: { title: string; body?: string };
  paneTreeChanged: { workspacePath: string; tree: PaneNodeState; flushNow?: boolean };
  saveLatencyStats: { id: string; stats: LatencyStats };
  terminalScrollbackUpdate: {
    entries: Array<{ terminalId: string; scrollback: string; cwd?: string }>;
  };
  windowClose: void;
  windowMinimize: void;
  windowMaximize: void;
}

// --- Webview-side messages (Bun pushes these, no response) ---

export interface WebviewMessages {
  terminalOutput: { id: string; data: string; seq: number };
  terminalExit: { id: string; exitCode: number };
  sessionIdResolved: { terminalId: string; sessionId: string };
  hookEvent: HookEvent;
  workspaceActivityChanged: { workspacePath: string; activityState: number | null; pid: number };
  workspacesChanged: { repoId: string; workspaces: TempestWorkspace[] };
  workspaceRenamed: { repoId: string; oldPath: string; newPath: string; workspace: TempestWorkspace };
  sidebarInfoUpdated: { workspacePath: string; info: WorkspaceSidebarInfo };
  configChanged: AppConfig;
  menuAction: { action: string };
  markdownFileChanged: { filePath: string; content: string; deleted?: boolean };
  directoryChanged: {
    workspacePath: string;
    changedDirPath: string;
    changeKind?: "create" | "delete" | "rename" | "unknown";
  };
  prDraftsChanged: { workspacePath: string; drafts: PRDraftSummary[] };
  scriptOutput: { runId: string; data: string };
  scriptExit: { runId: string; exitCode: number };
  selectWorkspace: { workspacePath: string };
  showWebpage: {
    title: string;
    filePath: string;
    workspacePath: string;
    pageId: string;
  };
  showMermaidDiagram: {
    title: string;
    filePath: string;
    workspacePath: string;
    diagramId: string;
  };
  showMarkdown: {
    title: string;
    filePath: string;
    workspacePath: string;
    markdownId: string;
  };
  // LSP push channels. Diagnostics fire whenever the server publishes for an
  // open document; serverStateChanged fires on every status transition; the
  // memory sample stream is gated by lspMemoryWatchStart/Stop.
  lspDiagnostics: { uri: string; diagnostics: LspDiagnostic[] };
  lspServerStateChanged: { state: LspServerState };
  lspMemoryUpdate: { samples: LspMemorySample[] };
}
