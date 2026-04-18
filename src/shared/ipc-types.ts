// ============================================================
// Shared type definitions used by both Bun and Webview processes
// ============================================================

// --- Activity & Status ---

export enum ActivityState {
  NeedsInput = 0, // Urgent: waiting for permission/input
  Working = 1, // Claude processing
  Idle = 2, // Idle/prompt
}

/** ConEmu OSC 9;4 progress state (matches @xterm/addon-progress). */
export enum ProgressState {
  None = 0,
  Set = 1,
  Error = 2,
  Indeterminate = 3,
  Pause = 4,
}

export enum WorkspaceStatus {
  Idle = "idle",
  Working = "working",
  NeedsInput = "needsInput",
  Exited = "exited",
  Error = "error",
}

// --- Editor Type ---

export enum EditorType {
  Neovim = "neovim",
  Monaco = "monaco",
}

// --- Pane Tab Kinds ---

export enum PaneTabKind {
  Claude = "claude",
  Pi = "pi",
  Shell = "shell",
  Browser = "browser",
  HistoryViewer = "historyViewer",
  MarkdownViewer = "markdownViewer",
  Editor = "editor",
  PRDashboard = "prDashboard",
}

// --- View Mode ---

export enum ViewMode {
  Terminal = "terminal",
  Dashboard = "dashboard",
  VCS = "vcs",
}

// --- VCS ---

export enum VCSType {
  Git = "git",
  JJ = "jj",
}

export enum BranchHealthStatus {
  Ok = "ok",
  NeedsRebase = "needsRebase",
  HasConflicts = "hasConflicts",
}

export enum DiffScope {
  CurrentChange = "currentChange",
  SinceTrunk = "sinceTrunk",
  SingleCommit = "singleCommit",
}

// --- Data Structures ---

export interface SourceRepo {
  id: string;
  path: string;
  name: string;
  isExpanded: boolean;
  vcsType: VCSType;
}

export interface TempestWorkspace {
  id: string;
  name: string;
  path: string;
  repoPath: string;
  status: WorkspaceStatus;
  errorMessage?: string;
}

export interface WorkspaceSidebarInfo {
  bookmarkName?: string;
  diffStats?: DiffStats;
  branchHealth?: BranchHealthStatus;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface Bookmark {
  id: string;
  url: string;
  label: string;
  createdAt: string; // ISO8601
  position: number;
}

export interface HttpServerConfig {
  enabled: boolean;
  port: number;
  hostname: string; // e.g. "0.0.0.0", "127.0.0.1", or a specific interface IP
  token: string;
}

export interface NetworkInterface {
  name: string;    // e.g. "en0", "lo0"
  address: string; // e.g. "192.168.1.100"
  family: "IPv4" | "IPv6";
}

export interface McpToolConfig {
  showWebpage: boolean;
}

export interface AppConfig {
  workspaceRoot: string;
  jjPath?: string;
  gitPath?: string;
  claudePath?: string;
  ghPath?: string;
  piPath?: string;
  claudeArgs: string[];
  piArgs?: string[];
  piEnvVarNames?: string[]; // Names of env vars passed to Pi at launch; values live in the macOS Keychain.
  editor?: string; // e.g. "nvim", "hx", "vim", "code". Defaults to "nvim".
  monacoVimMode?: boolean; // Enable vim keybindings in Monaco editor. Defaults to false.
  theme?: "dark" | "light"; // Appearance theme. Defaults to "dark".
  httpServer?: HttpServerConfig;
  httpDefaultPlanMode?: boolean; // Start HTTP-created workspaces in plan mode. Defaults to false.
  httpAllowTerminalConnect?: boolean; // Master switch: allow Tempest Remote to attach to running terminals at all. Defaults to false.
  httpAllowTerminalWrite?: boolean; // When connect is enabled, also let remote viewers send keystrokes/resize. Defaults to false (view-only).
  mcpTools?: McpToolConfig;
}

// --- Hook Events ---

export interface HookEvent {
  eventType: string;
  pid: number;
  sessionId?: string;
  cwd?: string;
  transcriptPath?: string;
  toolName?: string;
}

// --- Progress View ---

export enum WorkspaceStage {
  New = "new",
  InDevelopment = "inDevelopment",
  PullRequest = "pullRequest",
  Merged = "merged",
}

export interface PRDetailInfo {
  prNumber: number;
  prURL: string;
  state: "open" | "draft" | "merged" | "closed";
  title: string;
  openedAt: string;
  mergedAt?: string;
  reviewSummary: {
    approved: number;
    changesRequested: number;
    pending: number;
  };
  comments: {
    noResponse: number;
    unresolved: number;
    resolved: number;
  };
  checksPassed: number;
  checksFailed: number;
}

export interface WorkspaceProgressInfo {
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  repoName: string;
  repoPath: string;
  stage: WorkspaceStage;
  branchName?: string;
  diffStats?: DiffStats;
  activityState?: ActivityState;
  prDetail?: PRDetailInfo;
  isMonitored: boolean;
  prURL?: string;
  createdAt?: string;
  lastOpenedAt?: string;
}

// --- Open PR State ---

export interface OpenPRState {
  bookmarkName?: string; // jj only
  prURL: string;
}

// --- Session State (Persistence) ---

export interface SessionState {
  version: number;
  savedAt: string;
  selectedWorkspacePath?: string;
  workspaces: Record<string, WorkspacePaneState>;
  collapsedRepoIds?: string[];
}

export interface WorkspacePaneState {
  workspacePath: string;
  paneTree: PaneNodeState;
  prState?: OpenPRState;
}

export type PaneNodeState =
  | { type: "leaf"; pane: PaneState }
  | { type: "split"; children: PaneNodeState[]; ratios: number[] };

export interface PaneState {
  tabs: PaneTabState[];
  selectedTabIndex: number;
}

export interface PaneTabState {
  kind: PaneTabKind;
  label: string;
  sessionID?: string; // Uppercase D — matches Swift Tempest format
  sessionId?: string; // Accept lowercase too for forward compat
  terminalId?: string; // Ephemeral: used by backend for PID→session lookup, not persisted
  browserURL?: string;
  markdownFilePath?: string;
  editorFilePath?: string;
  editorLineNumber?: number;
  editorType?: EditorType;
  diffScope?: DiffScope;
  shellCwd?: string; // Last known CWD for shell terminals (tracked via OSC 7)
  scrollbackContent?: string; // Serialized terminal scrollback for session restore
}

// --- Usage Tracking ---

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCost: number;
}

export interface UsageResponse {
  dailyTotals: UsageTokens | null;
  projectBreakdowns: Record<string, UsageTokens>;
  isStale: boolean;
}

// --- Binary Check ---

export interface BinaryStatus {
  git: boolean;
  jj: boolean;
  claude: boolean;
  gh: boolean;
}

// --- History ---

export interface SessionSummary {
  filePath: string;
  firstPrompt: string;
  createdAt?: string; // ISO date
  modifiedAt?: string; // ISO date
  gitBranch?: string;
}

export interface SessionMessage {
  type: "user" | "assistant" | "system";
  text: string;
  toolCalls?: ToolCallInfo[];
  timestamp?: string;
}

export interface ToolCallInfo {
  tool: string;
  summary: string; // e.g. "Read src/index.ts" or "Bash: npm test"
  input?: string; // raw input JSON for expandable view
  inputParamCount?: number;
}

// --- AI Context ---

export interface FileAIContext {
  filePath: string;
  sessions: AISessionContext[];
  totalChanges: number;
}

export interface AISessionContext {
  id: string;
  sessionSummary: string;
  messages: SessionMessage[];
  fileChanges: FileChangeEvent[];
}

export interface FileChangeEvent {
  id: string;
  messageIndex: number;
  toolCallIndex: number;
  toolName: string;
  inputSummary: string;
  timestamp?: string; // ISO date
}

export interface FileChangeTimeline {
  filePath: string;
  changes: FileVersionChange[];
}

export interface FileVersionChange {
  id: string;
  eventId: string;
  index: number;
  timestamp?: string; // ISO date
  sessionId: string;
  toolName: string;
  detail: ToolChangeDetail;
  conversationContext: string;
}

export type ToolChangeDetail =
  | { type: "edit"; oldString: string; newString: string }
  | { type: "write"; fullContent: string }
  | { type: "unknown"; summary: string };

// --- Repo Settings ---

export interface ScriptParameter {
  name: string;         // env var name (e.g. "BRANCH_NAME")
  displayName: string;  // human-readable label (e.g. "Branch Name")
}

export interface CustomScript {
  id: string;
  name: string;
  script: string;       // inline script content (empty if using scriptPath)
  scriptPath?: string;  // path to linked script file on disk
  parameters?: ScriptParameter[];
  showOutput?: boolean;
}

export interface RepoSettings {
  prepareScript: string;
  archiveScript: string;
  customScripts?: CustomScript[];
  disablePackageScripts?: boolean;
  hiddenPackageScripts?: string[];
}

// --- Assigned PRs ---

export interface AssignedPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
}

// --- PR Feedback ---

export interface PRDraftSummary {
  id: string;
  nodeId: string;
  replyText: string;
  hasCodeChange: boolean;
  commitDescription?: string;
  commitRef?: string;
  createdAt: string;
  status: "pending" | "approved" | "sent" | "failed" | "dismissed";
  failureMessage?: string;
  // Original comment context
  originalAuthor?: string;
  originalBody?: string;
  originalPath?: string;
  originalLine?: number;
}

// --- Latency Stats (from prototype) ---

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  throughputBytesPerSec: number;
  renderFrameAvgMs: number;
}

// --- VCS Commit View ---

export type VCSFileChangeType =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

export interface VCSFileEntry {
  path: string;
  oldPath?: string; // for renames
  changeType: VCSFileChangeType;
  staged: boolean;
}

export interface VCSStatusResult {
  branch: string;
  files: VCSFileEntry[];
  ahead: number;
  behind: number;
}

export interface VCSCommitResult {
  success: boolean;
  error?: string;
  commitHash?: string;
}

export interface VCSFileDiffResult {
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  language: string;
}

// --- Git Commit/Scope Selection ---

export interface GitCommitEntry {
  hash: string;
  fullHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitCommitLogResult {
  commits: GitCommitEntry[];
  branch: string;
}

export interface GitScopedFileEntry {
  path: string;
  oldPath?: string;
  changeType: VCSFileChangeType;
}

export interface GitScopedFilesResult {
  files: GitScopedFileEntry[];
  summary: string;
}

// --- JJ (Jujutsu) VCS View ---

export interface JJRevision {
  changeId: string;
  commitId: string;
  description: string;
  author: string;
  email: string;
  timestamp: string;
  bookmarks: string[];
  workingCopies: string[];  // workspace names, e.g. ["vcs-view", "default"]
  isWorkingCopy: boolean;
  isEmpty: boolean;
  isImmutable: boolean;
  // Graph rendering data (from jj log with graph)
  nodeGraphPrefix: string;       // graph prefix for the node line (e.g. "@  ", "│ ○  ")
  trailingGraphLines: string[];  // graph-only lines between this rev and the next
}

export interface JJLogResult {
  revisions: JJRevision[];
  currentChangeId: string;
}

export interface JJChangedFile {
  path: string;
  changeType: VCSFileChangeType;
}

export interface JJBookmark {
  name: string;
  remote?: string;
  isTracked: boolean;
}
