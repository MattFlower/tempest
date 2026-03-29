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
}

// --- VCS ---

export enum VCSType {
  Git = "git",
  JJ = "jj",
}

export enum DiffScope {
  CurrentChange = "currentChange",
  SinceTrunk = "sinceTrunk",
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
