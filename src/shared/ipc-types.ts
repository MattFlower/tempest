// ============================================================
// Shared type definitions used by both Bun and Webview processes
// ============================================================

// --- Activity & Status ---

export enum ActivityState {
  NeedsInput = 0, // Urgent: waiting for permission/input
  Working = 1, // Claude processing
  Idle = 2, // Idle/prompt
}

export enum WorkspaceStatus {
  Idle = "idle",
  Working = "working",
  NeedsInput = "needsInput",
  Exited = "exited",
  Error = "error",
}

// --- Pane Tab Kinds ---

export enum PaneTabKind {
  Claude = "claude",
  Shell = "shell",
  Browser = "browser",
  HistoryViewer = "historyViewer",
  MarkdownViewer = "markdownViewer",
  Editor = "editor",
  DiffViewer = "diffViewer",
  PRDashboard = "prDashboard",
}

// --- View Mode ---

export enum ViewMode {
  Terminal = "terminal",
  Diff = "diff",
  Dashboard = "dashboard",
}

// --- VCS ---

export enum VCSType {
  Git = "git",
  JJ = "jj",
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
}

export interface AppConfig {
  workspaceRoot: string;
  jjPath?: string;
  gitPath?: string;
  claudePath?: string;
  ghPath?: string;
  claudeArgs: string[];
  editor?: string; // e.g. "nvim", "hx", "vim", "code". Defaults to "nvim".
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

// --- Session State (Persistence) ---

export interface SessionState {
  version: number;
  savedAt: string;
  selectedWorkspacePath?: string;
  workspaces: Record<string, WorkspacePaneState>;
}

export interface WorkspacePaneState {
  workspacePath: string;
  paneTree: PaneNodeState;
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
  browserURL?: string;
  markdownFilePath?: string;
  editorFilePath?: string;
  editorLineNumber?: number;
  diffScope?: DiffScope;
}

// --- Diff Viewer ---

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: "modified" | "added" | "deleted" | "renamed";
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

// --- AI Context (for Diff Viewer) ---

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
