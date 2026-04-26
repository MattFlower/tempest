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
  Codex = "codex",
  Shell = "shell",
  Browser = "browser",
  HistoryViewer = "historyViewer",
  MarkdownViewer = "markdownViewer",
  Editor = "editor",
  PRDashboard = "prDashboard",
  KeymapHelp = "keymapHelp",
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
  showWebpage?: boolean;
  showMermaidDiagram?: boolean;
  showMarkdown?: boolean;
}

export interface AppConfig {
  workspaceRoot: string;
  jjPath?: string;
  gitPath?: string;
  claudePath?: string;
  ghPath?: string;
  piPath?: string;
  codexPath?: string;
  claudeArgs: string[];
  piArgs?: string[];
  codexArgs?: string[];
  piEnvVarNames?: string[]; // Names of env vars passed to Pi at launch; values live in the macOS Keychain.
  codexEnvVarNames?: string[]; // Names of env vars passed to Codex at launch; values live in the macOS Keychain.
  editor?: string; // e.g. "nvim", "hx", "vim", "code". Defaults to "nvim".
  monacoVimMode?: boolean; // Enable vim keybindings in Monaco editor. Defaults to false.
  theme?: "dark" | "light"; // Appearance theme. Defaults to "dark".
  httpServer?: HttpServerConfig;
  httpDefaultPlanMode?: boolean; // Start HTTP-created workspaces in plan mode. Defaults to false.
  httpAllowTerminalConnect?: boolean; // Master switch: allow Tempest Remote to attach to running terminals at all. Defaults to false.
  httpAllowTerminalWrite?: boolean; // When connect is enabled, also let remote viewers send keystrokes/resize. Defaults to false (view-only).
  mcpTools?: McpToolConfig;
  // Keybinding overrides: command id → normalized keystroke (e.g. "cmd+shift+p" or "cmd+k cmd+s").
  // `null` means "explicitly unbound" (suppress the default). A missing id uses its command's default binding.
  keybindings?: Record<string, string | null>;
  // Master switch for LSP integration. When true, no language servers spawn
  // anywhere; running servers are torn down and Monaco markers cleared.
  lspDisabled?: boolean;
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
  /** Absolute path to the Claude Code plan file for this workspace's first
   * persisted Claude tab, if one exists on disk. */
  planPath?: string;
}

// --- Open PR State ---

export interface OpenPRState {
  bookmarkName?: string; // jj only
  prURL: string;
}

// --- Find in Files ---

export interface FindInFilesMatch {
  filePath: string;
  lineNumber: number;
  lineText: string;
  submatches: { start: number; end: number }[];
}

export interface FindInFilesResult {
  matches: FindInFilesMatch[];
  truncated: boolean;
  error?: string;
}

// --- File Tree ---

export interface DirEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  isSymlink: boolean;
  /** True if the entry matches .gitignore / .jj-ignore rules, or one of the
   *  hardcoded "always ignore" directory names (node_modules, dist, etc.).
   *  Ignored entries are rendered dimmed but still shown. */
  isIgnored?: boolean;
}

export type SidebarView = "workspaces" | "files";

export interface FileTreeSessionState {
  activeSidebarView?: SidebarView;
  expandedRepoIds?: string[];
  expandedWorkspacePaths?: string[];
  expandedDirs?: string[];
  cursor?: string | null;
  scrollTop?: number;
  /** When true, ignored files / dotfiles render at full opacity. */
  showHidden?: boolean;
  /** When true, the tree auto-reveals the active Monaco file on change. */
  autoReveal?: boolean;
}

// --- Session State (Persistence) ---

export interface SessionState {
  version: number;
  savedAt: string;
  selectedWorkspacePath?: string;
  workspaces: Record<string, WorkspacePaneState>;
  collapsedRepoIds?: string[];
  fileTree?: FileTreeSessionState;
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
  codex: boolean;
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

export type ScriptRunMode = "modal" | "bottomPane";

export interface CustomScript {
  id: string;
  name: string;
  script: string;       // inline script content (empty if using scriptPath)
  scriptPath?: string;  // path to linked script file on disk
  parameters?: ScriptParameter[];
  showOutput?: boolean;
  runMode?: ScriptRunMode; // defaults to "modal"
}

export interface RepoSettings {
  prepareScript: string;
  archiveScript: string;
  customScripts?: CustomScript[];
  disablePackageScripts?: boolean;
  hiddenPackageScripts?: string[];
  packageScriptRunMode?: Record<string, ScriptRunMode>;
  disableMavenScripts?: boolean;
  hiddenMavenScripts?: string[];
  mavenScriptRunMode?: Record<string, ScriptRunMode>;
  // Per-repo override: when true, no LSP servers spawn for workspaces under
  // this repo, regardless of the global setting.
  disableLsp?: boolean;
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

// --- Git Branch / Remote Operations ---

export interface GitBranchInfo {
  name: string;
  isRemote: boolean;
  remote?: string;
  isCurrent: boolean;
}

export interface GitBranchListResult {
  branches: GitBranchInfo[];
  current: string | null;
  remotes: string[];
}

export interface GitOpResult {
  success: boolean;
  error?: string;
  output?: string;
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

// --- LSP (Language Server Protocol) ---
//
// Phase 1 surfaces hover, go-to-definition, and diagnostics. The protocol
// bridge lives in src/bun/lsp/. The webview registers Monaco providers that
// proxy through these RPC calls. See AI_DOCS/lsp.md (when written) for the
// full lifecycle.

export type LspServerStatus =
  | "installing" // bun add in flight (npm bucket) — no process spawned yet
  | "starting"   // process spawned, awaiting initialize response
  | "ready"      // initialized; serving requests
  | "indexing"   // server is actively indexing (rust-analyzer-style)
  | "error"      // crashed or failed to install/initialize; user can retry
  | "stopped";   // explicitly stopped (workspace closed, settings disabled)

/**
 * Public-facing snapshot of one running LSP server. Pushed to the webview on
 * state transitions; the footer's popover renders these directly.
 */
export interface LspServerState {
  /** Composite key: `${workspacePath}::${languageId}`. */
  id: string;
  workspacePath: string;
  /** Monaco-style language id (e.g. "typescript", "python"). */
  languageId: string;
  /** Display name pulled from the server's recipe (e.g. "typescript-language-server"). */
  serverName: string;
  status: LspServerStatus;
  /** OS process id once spawned. Absent before spawn or after exit. */
  pid?: number;
  /** Last error message, populated when status is "error". */
  lastError?: string;
  /** Times the server has been auto-restarted since spawn. */
  restartCount: number;
}

/**
 * LSP position uses 0-based line/character (UTF-16 code units). Monaco uses
 * 1-based line/column — the bridge converts at the boundary. We keep the
 * LSP-native shape here because it's what the wire carries.
 */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4; // Error | Warning | Info | Hint

export interface LspDiagnostic {
  range: LspRange;
  severity?: LspDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

/** Hover content. We pass through markdown strings as-is from the server. */
export interface LspHoverResult {
  contents: string[]; // markdown blocks, in display order
  range?: LspRange;
}

export interface LspMemorySample {
  serverId: string;
  /** Resident set size in bytes, or null if the process has exited. */
  rssBytes: number | null;
}

// --- LSP completion ---

/** LSP CompletionItemKind values. Matches the spec's numeric enum so
 *  the wire format passes through unchanged. */
export const LspCompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;
export type LspCompletionItemKindValue =
  (typeof LspCompletionItemKind)[keyof typeof LspCompletionItemKind];

/** A single completion item returned by textDocument/completion. We
 *  forward only the fields Monaco actually consumes — the server's
 *  opaque `data` for resolve isn't used in Phase 3 (we don't implement
 *  completionItem/resolve yet). */
export interface LspCompletionItem {
  label: string;
  kind?: LspCompletionItemKindValue;
  /** Short detail line, usually the type signature. */
  detail?: string;
  /** Documentation block, possibly markdown. */
  documentation?: string;
  /** What to insert. May contain LSP snippet placeholders ($1, $2, etc.). */
  insertText?: string;
  /** 1 = plain text, 2 = snippet (the spec's InsertTextFormat enum). */
  insertTextFormat?: 1 | 2;
  /** Optional range to replace; absent means "use the word the cursor is on". */
  range?: LspRange;
  /** Hint to the editor's sort order. Lexicographic compare. */
  sortText?: string;
  /** Hint for fuzzy filtering; if absent, Monaco filters on `label`. */
  filterText?: string;
}

export interface LspCompletionList {
  /** True when the list is incomplete and the editor should re-query
   *  on the next keystroke (for completion engines that stream). */
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

// --- LSP document symbols ---

export type LspSymbolKind = number; // 1..26 in the spec; we forward as-is

/** Hierarchical symbol info for textDocument/documentSymbol. The
 *  legacy SymbolInformation flat shape is also valid in the spec but
 *  modern servers return DocumentSymbol; we normalize on the Bun side. */
export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  /** Whole-symbol range (including body). */
  range: LspRange;
  /** Highlighted-name range (where the editor places the cursor on click). */
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

// --- LSP workspace edit (used by rename) ---

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** Subset of the spec's WorkspaceEdit we currently apply: a per-URI map
 *  of text edits. The full spec also supports `documentChanges` (with
 *  versioning + create/rename/delete file ops); rename of a symbol
 *  rarely uses those, so Phase 3 sticks to plain text edits. */
export interface LspWorkspaceEdit {
  changes: Record<string, LspTextEdit[]>;
}

/** Result of textDocument/prepareRename. `null` from the server means
 *  the cursor isn't on a renameable symbol. */
export interface LspPrepareRenameResult {
  range: LspRange;
  /** Optional placeholder text shown in Monaco's rename input. */
  placeholder?: string;
}

// --- LSP signature help ---

/** A single parameter inside a function/method signature. The `label` is
 *  either a string match against `signature.label` or a `[start, end]`
 *  offset pair; we always normalize to the offset form on the Bun side
 *  so the webview's renderer never has to do substring search. */
export interface LspParameterInformation {
  /** Offsets into the parent signature's label string, [start, end). */
  label: [number, number];
  /** Optional doc/help text shown when this parameter is the active one. */
  documentation?: string;
}

export interface LspSignatureInformation {
  /** Full signature label, e.g. "fetch(input: RequestInfo, init?: RequestInit): Promise<Response>". */
  label: string;
  documentation?: string;
  parameters: LspParameterInformation[];
  /** Index of the active parameter for *this* signature (overrides
   *  SignatureHelp.activeParameter when set). */
  activeParameter?: number;
}

export interface LspSignatureHelp {
  signatures: LspSignatureInformation[];
  /** Index of the currently-shown signature. */
  activeSignature: number;
  /** Index of the currently-active parameter within `activeSignature`. */
  activeParameter: number;
}

// --- LSP inlay hints ---

/** Hint kinds — matches the spec's numeric enum. */
export type LspInlayHintKind = 1 | 2; // 1 = Type, 2 = Parameter

/** Inlay hints can have either a plain string label or a list of label
 *  parts (each part can carry its own tooltip / command). For Phase 4
 *  v1 we only render the visual text — interaction (click → action) is
 *  a future polish. */
export interface LspInlayHintLabelPart {
  value: string;
  tooltip?: string;
}

export interface LspInlayHint {
  position: LspPosition;
  /** Either the rendered text (string) or a list of parts (array). */
  label: string | LspInlayHintLabelPart[];
  kind?: LspInlayHintKind;
  /** Optional tooltip when hovering the hint. */
  tooltip?: string;
  /** Whether to add a leading/trailing space to the hint when rendered. */
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

// --- LSP code actions ---

/** Code action kinds — strings per the spec, hierarchical (`refactor.extract`).
 *  We pass them through unchanged; Monaco accepts arbitrary kind strings. */
export type LspCodeActionKind = string;

/** Diagnostics passed to the server as context for the code action
 *  request — Monaco's editor sends the diagnostics it has on the range,
 *  the server uses them to decide which quickfixes apply. */
export interface LspCodeActionContext {
  diagnostics: LspDiagnostic[];
  only?: LspCodeActionKind[];
}

/** A reference to a server-side command. The `arguments` are opaque
 *  to us — we forward them back via workspace/executeCommand when the
 *  user invokes the action. */
export interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

/** A code action returned by textDocument/codeAction. Either `edit` or
 *  `command` (or both) drives what happens on apply: `edit` is applied
 *  client-side via our existing applyWorkspaceEdit; `command` is sent
 *  back to the server via workspace/executeCommand. */
export interface LspCodeAction {
  title: string;
  kind?: LspCodeActionKind;
  /** Diagnostics this action addresses (for "fix all" visualizations). */
  diagnostics?: LspDiagnostic[];
  /** Whether this is the preferred / canonical fix for the diagnostics
   *  it addresses. Monaco uses this to bind keyboard shortcuts. */
  isPreferred?: boolean;
  edit?: LspWorkspaceEdit;
  command?: LspCommand;
}

