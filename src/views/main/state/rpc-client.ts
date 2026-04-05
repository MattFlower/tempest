// ============================================================
// Typed RPC client for the webview process.
// Wraps Electrobun's RPC with sequence ordering for terminal output.
// ============================================================

import { Electroview } from "electrobun/view";
import type { BunMessages, WebviewMessages } from "../../../shared/rpc-schema";
import { getAllTerminalInstances } from "./terminal-registry";

// Sequence-ordered output buffer for terminal output.
// Electrobun's async encrypted WebSocket can deliver RPC messages
// out of order. We buffer and replay in sequence.
const nextExpectedSeq = new Map<string, number>();
const pendingOutputs = new Map<string, Map<number, string>>();

type TerminalOutputHandler = (id: string, data: string) => void;
let terminalOutputHandler: TerminalOutputHandler | null = null;

export function onTerminalOutput(handler: TerminalOutputHandler) {
  terminalOutputHandler = handler;
}

// If a sequence number is missed (e.g. message lost while app was backgrounded),
// waiting forever would deadlock all output for that terminal. After this many
// out-of-order messages queue up, skip ahead to unblock.
const SEQ_GAP_THRESHOLD = 10;

function processTerminalOutput(id: string, data: string, seq: number) {
  const expected = nextExpectedSeq.get(id) ?? 1;

  if (seq === expected) {
    terminalOutputHandler?.(id, data);
    nextExpectedSeq.set(id, seq + 1);

    const pending = pendingOutputs.get(id);
    if (pending) {
      let next = seq + 1;
      while (pending.has(next)) {
        terminalOutputHandler?.(id, pending.get(next)!);
        pending.delete(next);
        next++;
      }
      nextExpectedSeq.set(id, next);
    }
  } else if (seq > expected) {
    if (!pendingOutputs.has(id)) pendingOutputs.set(id, new Map());
    const pending = pendingOutputs.get(id)!;
    pending.set(seq, data);

    // If too many messages are buffered, a sequence number was likely lost.
    // Flush everything we have in order starting from the lowest buffered seq.
    if (pending.size >= SEQ_GAP_THRESHOLD) {
      console.warn(`[rpc] Terminal ${id}: seq gap detected (expected ${expected}, have ${pending.size} buffered). Flushing.`);
      const sorted = Array.from(pending.keys()).sort((a, b) => a - b);
      for (const s of sorted) {
        terminalOutputHandler?.(id, pending.get(s)!);
      }
      pending.clear();
      nextExpectedSeq.set(id, sorted[sorted.length - 1] + 1);
    }
  }
}

// Message handlers for messages FROM Bun
type TerminalExitHandler = (id: string, exitCode: number) => void;
type HookEventHandler = (event: WebviewMessages["hookEvent"]) => void;
type MarkdownFileChangedHandler = (filePath: string, content: string, deleted?: boolean) => void;
type PRDraftsChangedHandler = (workspacePath: string, drafts: any[]) => void;

let terminalExitHandler: TerminalExitHandler | null = null;
let hookEventHandler: HookEventHandler | null = null;
const markdownFileChangedHandlers = new Set<MarkdownFileChangedHandler>();
let prDraftsChangedHandler: PRDraftsChangedHandler | null = null;

export function onTerminalExit(handler: TerminalExitHandler) {
  terminalExitHandler = handler;
}

export function onHookEvent(handler: HookEventHandler) {
  hookEventHandler = handler;
}

export function onMarkdownFileChanged(handler: MarkdownFileChangedHandler): () => void {
  markdownFileChangedHandlers.add(handler);
  return () => { markdownFileChangedHandlers.delete(handler); };
}

export function onPRDraftsChanged(handler: PRDraftsChangedHandler) {
  prDraftsChangedHandler = handler;
}

export function offPRDraftsChanged() {
  prDraftsChangedHandler = null;
}

// Script output streaming — keyed by runId
type ScriptOutputHandler = (data: string) => void;
type ScriptExitHandler = (exitCode: number) => void;
const scriptOutputHandlers = new Map<string, ScriptOutputHandler>();
const scriptExitHandlers = new Map<string, ScriptExitHandler>();

export function onScriptRun(
  runId: string,
  onOutput: ScriptOutputHandler,
  onExit: ScriptExitHandler,
): () => void {
  scriptOutputHandlers.set(runId, onOutput);
  scriptExitHandlers.set(runId, onExit);
  return () => {
    scriptOutputHandlers.delete(runId);
    scriptExitHandlers.delete(runId);
  };
}

/** Walk a PaneNode tree and update the sessionId on the tab matching the given terminalId. */
function updateTabSessionId(node: any, terminalId: string, sessionId: string): boolean {
  if (!node) return false;
  if (node.type === "leaf" && node.pane?.tabs) {
    for (const tab of node.pane.tabs) {
      if (tab.terminalId === terminalId) {
        tab.sessionId = sessionId;
        return true;
      }
    }
    return false;
  }
  if (node.type === "split" && node.children) {
    for (const child of node.children) {
      if (updateTabSessionId(child, terminalId, sessionId)) return true;
    }
  }
  return false;
}

// Initialize RPC and Electroview
const rpc = Electroview.defineRPC({
  maxRequestTime: 120_000, // native file dialogs block until user selects
  handlers: {
    requests: {
      getTerminalScrollback: () => {
        const instances = getAllTerminalInstances();
        const entries: Array<{ terminalId: string; scrollback: string; cwd?: string }> = [];
        for (const [id, instance] of instances) {
          try {
            entries.push({
              terminalId: id,
              scrollback: instance.serializeScrollback(200),
              cwd: instance.cwd,
            });
          } catch { /* terminal may be disposed */ }
        }
        return { entries };
      },
    },
    messages: {
      terminalOutput: ({
        id,
        data,
        seq,
      }: WebviewMessages["terminalOutput"]) => {
        processTerminalOutput(id, data, seq);
      },
      terminalExit: ({ id, exitCode }: WebviewMessages["terminalExit"]) => {
        terminalExitHandler?.(id, exitCode);
      },
      sessionIdResolved: (msg: any) => {
        import("./store").then(({ useStore }) => {
          const store = useStore.getState();
          // Find the tab with this terminalId across all workspace pane trees and update its sessionId
          for (const [wsPath, tree] of Object.entries(store.paneTrees)) {
            if (updateTabSessionId(tree as any, msg.terminalId, msg.sessionId)) {
              store.setPaneTree(wsPath, tree as any);
              break;
            }
          }
        });
      },
      hookEvent: (event: WebviewMessages["hookEvent"]) => {
        hookEventHandler?.(event);
      },
      workspaceActivityChanged: (msg: any) => {
        if (msg.activityState !== null && msg.activityState !== undefined) {
          import("./store").then(({ useStore }) => {
            useStore.getState().setWorkspaceActivity(msg.workspacePath, msg.activityState);
          });
        }
      },
      workspacesChanged: (msg: WebviewMessages["workspacesChanged"]) => {
        // Handled by store subscription — imported dynamically to avoid circular deps
        import("./store").then(({ useStore }) => {
          useStore.getState().setWorkspaces(msg.repoId, msg.workspaces);
        });
      },
      sidebarInfoUpdated: (msg: WebviewMessages["sidebarInfoUpdated"]) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().setSidebarInfo(msg.workspacePath, msg.info);
        });
      },
      configChanged: (config: WebviewMessages["configChanged"]) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().setConfig(config);
        });
      },
      markdownFileChanged: (msg: any) => {
        for (const handler of markdownFileChangedHandlers) {
          handler(msg.filePath, msg.content, msg.deleted);
        }
      },
      prDraftsChanged: (msg: any) => {
        if (prDraftsChangedHandler) {
          prDraftsChangedHandler(msg.workspacePath, msg.drafts);
        }
      },
      scriptOutput: (msg: any) => {
        scriptOutputHandlers.get(msg.runId)?.(msg.data);
      },
      scriptExit: (msg: any) => {
        scriptExitHandlers.get(msg.runId)?.(msg.exitCode);
        scriptOutputHandlers.delete(msg.runId);
        scriptExitHandlers.delete(msg.runId);
      },
      selectWorkspace: (msg: any) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().selectWorkspace(msg.workspacePath);
        });
      },
      menuAction: (msg: any) => {
        Promise.all([
          import("./store"),
          import("./actions"),
          import("../../../shared/ipc-types"),
        ]).then(([{ useStore }, actions, { ViewMode }]) => {
          const store = useStore.getState();
          switch (msg.action) {
            case "toggle-sidebar":
              store.toggleSidebar();
              break;
            case "settings":
              store.toggleSettingsDialog();
              break;
            case "command-palette":
              store.toggleCommandPalette();
              break;
            case "open-file":
              store.openCommandPaletteFiles();
              break;
            case "new-workspace": {
              // Find the repo for the currently selected workspace, or use the first repo
              const selectedPath = store.selectedWorkspacePath;
              let targetRepoId: string | null = null;
              if (selectedPath) {
                for (const [repoId, workspaces] of Object.entries(store.workspacesByRepo)) {
                  if (workspaces.some((ws: any) => ws.path === selectedPath)) {
                    targetRepoId = repoId;
                    break;
                  }
                }
              }
              if (!targetRepoId && store.repos.length > 0) {
                targetRepoId = store.repos[0].id;
              }
              if (targetRepoId) {
                store.requestNewWorkspace(targetRepoId);
              }
              break;
            }
            case "add-repo":
              // Ensure sidebar is visible so user can use the Add Repository button
              if (!store.sidebarVisible) store.toggleSidebar();
              break;
            case "view-terminal":
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.Terminal);
              }
              break;
            case "view-diff":
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.Diff);
              }
              break;
            case "view-dashboard":
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.Dashboard);
              }
              break;
            case "view-vcs":
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.VCS);
              }
              break;
            case "toggle-devtools":
              import("./devtools").then(({ toggleDevTools }) => toggleDevTools());
              break;
          }
        });
      },
    },
  },
});

const electroview = new Electroview({ rpc });

// Export typed RPC proxy for webview → bun calls
export const rpcRequest = rpc.request as any;
export const rpcSend = rpc.send as any;

// Convenience typed wrappers
export const api = {
  // Terminal
  createTerminal: (params: {
    id: string;
    command: string[];
    cwd: string;
    env?: Record<string, string>;
    cols: number;
    rows: number;
  }) => rpcRequest.createTerminal(params),

  resizeTerminal: (params: { id: string; cols: number; rows: number }) =>
    rpcRequest.resizeTerminal(params),

  killTerminal: (params: { id: string }) => rpcRequest.killTerminal(params),

  writeToTerminal: (id: string, data: string) =>
    rpcSend.writeToTerminal({ id, data }),

  clipboardWrite: (text: string) => rpcSend.clipboardWrite({ text }),

  showNotification: (title: string, body?: string) =>
    rpcSend.showNotification({ title, body }),

  // Session commands
  buildClaudeCommand: (params: {
    workspacePath: string;
    resume: boolean;
    sessionId?: string;
    withHooks: boolean;
    withChannel?: boolean;
    workspaceName?: string;
  }) => rpcRequest.buildClaudeCommand(params),

  buildShellCommand: (params: { workspacePath: string }) =>
    rpcRequest.buildShellCommand(params),
  buildEditorCommand: (filePath: string, lineNumber?: number) =>
    rpcRequest.buildEditorCommand({ filePath, lineNumber }),

  // Repos
  getRepos: () => rpcRequest.getRepos(),
  addRepo: (path: string) => rpcRequest.addRepo({ path }),
  removeRepo: (repoId: string) => rpcRequest.removeRepo({ repoId }),

  // Workspaces
  getBranches: (repoId: string) => rpcRequest.getBranches({ repoId }),
  getWorkspaces: (repoId: string) => rpcRequest.getWorkspaces({ repoId }),
  createWorkspace: (params: {
    repoId: string;
    name: string;
    branch?: string;
    useExistingBranch?: boolean;
  }) => rpcRequest.createWorkspace(params),
  archiveWorkspace: (workspaceId: string) =>
    rpcRequest.archiveWorkspace({ workspaceId }),

  // Sidebar
  getSidebarInfo: (workspacePath: string) =>
    rpcRequest.getSidebarInfo({ workspacePath }),
  getVCSType: (repoPath: string) =>
    rpcRequest.getVCSType({ repoPath }),

  // Config
  getConfig: () => rpcRequest.getConfig(),
  saveConfig: (config: any) => rpcRequest.saveConfig(config),

  // Repo settings
  getRepoSettings: (repoPath: string) =>
    rpcRequest.getRepoSettings({ repoPath }),
  saveRepoSettings: (repoPath: string, settings: any) =>
    rpcRequest.saveRepoSettings({ repoPath, settings }),
  testPrepareScript: (repoPath: string, script: string) =>
    rpcRequest.testPrepareScript({ repoPath, script }),
  testArchiveScript: (repoPath: string, script: string) =>
    rpcRequest.testArchiveScript({ repoPath, script }),

  // Custom scripts
  runCustomScript: (params: {
    repoPath: string;
    workspacePath: string;
    workspaceName: string;
    script?: string;
    scriptPath?: string;
    paramValues?: Record<string, string>;
  }) => rpcRequest.runCustomScript(params),
  getPackageScripts: (workspacePath: string) =>
    rpcRequest.getPackageScripts({ workspacePath }),
  browseFile: (startingFolder?: string) =>
    rpcRequest.browseFile({ startingFolder }),
  getRemoteRepos: (repoPath: string) =>
    rpcRequest.getRemoteRepos({ repoPath }),

  // Bookmarks
  getBookmarks: (repoPath: string) => rpcRequest.getBookmarks({ repoPath }),
  addBookmark: (repoPath: string, url: string, label: string) =>
    rpcRequest.addBookmark({ repoPath, url, label }),
  removeBookmark: (repoPath: string, bookmarkId: string) =>
    rpcRequest.removeBookmark({ repoPath, bookmarkId }),
  updateBookmark: (repoPath: string, bookmarkId: string, label: string, url?: string) =>
    rpcRequest.updateBookmark({ repoPath, bookmarkId, label, url }),

  // Session state
  loadSessionState: () => rpcRequest.loadSessionState(),
  savePaneState: (workspacePath: string, paneTree: any) =>
    rpcRequest.savePaneState({ workspacePath, paneTree }),

  // Files
  listFiles: (workspacePath: string) =>
    rpcRequest.listFiles({ workspacePath }),

  // Pane tree sync
  notifyPaneTreeChanged: (workspacePath: string, tree: any) =>
    rpcSend.paneTreeChanged({ workspacePath, tree }),

  // Terminal scrollback persistence
  sendTerminalScrollbackUpdate: (
    entries: Array<{ terminalId: string; scrollback: string; cwd?: string }>,
  ) => rpcSend.terminalScrollbackUpdate({ entries }),

  // Onboarding
  checkBinaries: () => rpcRequest.checkBinaries(),
  setWorkspaceRoot: (path: string) => rpcRequest.setWorkspaceRoot({ path }),
  browseDirectory: (startingFolder?: string) => rpcRequest.browseDirectory({ startingFolder }),

  // Usage tracking
  getUsageData: (since?: string) => rpcRequest.getUsageData({ since }),

  // History
  getHistorySessions: (scope: "all" | "project", projectPath?: string) =>
    rpcRequest.getHistorySessions({ scope, projectPath }),
  searchHistory: (query: string, scope: "all" | "project", projectPath?: string) =>
    rpcRequest.searchHistory({ query, scope, projectPath }),
  getSessionMessages: (sessionFilePath: string) =>
    rpcRequest.getSessionMessages({ sessionFilePath }),
  isHistorySearchAvailable: () =>
    rpcRequest.isHistorySearchAvailable(undefined as any),

  // Plan lookup
  getSessionPlanPath: (sessionId: string, workspacePath: string) =>
    rpcRequest.getSessionPlanPath({ sessionId, workspacePath }),

  // Markdown
  readMarkdownFile: (filePath: string) =>
    rpcRequest.readMarkdownFile({ filePath }),
  watchMarkdownFile: (filePath: string) =>
    rpcRequest.watchMarkdownFile({ filePath }),
  unwatchMarkdownFile: (filePath: string) =>
    rpcRequest.unwatchMarkdownFile({ filePath }),

  // File operations (for Monaco editor)
  readFileForEditor: (filePath: string) =>
    rpcRequest.readFileForEditor({ filePath }),
  writeFileForEditor: (filePath: string, content: string) =>
    rpcRequest.writeFileForEditor({ filePath, content }),
  resolveModulePath: (specifier: string, fromFilePath: string) =>
    rpcRequest.resolveModulePath({ specifier, fromFilePath }),

  // Diff viewer
  getDiff: (workspacePath: string, scope: string, contextLines?: number, commitRef?: string) =>
    rpcRequest.getDiff({ workspacePath, scope, contextLines, commitRef }),
  getAIContextForFile: (filePath: string, projectPath?: string) =>
    rpcRequest.getAIContextForFile({ filePath, projectPath }),
  getAITimelineForFile: (filePath: string, projectPath?: string) =>
    rpcRequest.getAITimelineForFile({ filePath, projectPath }),

  // PR URL Lookup
  lookupPRUrl: (workspacePath: string) =>
    rpcRequest.lookupPRUrl({ workspacePath }),

  // Open PR
  getDefaultPRTitleBody: (workspacePath: string, bookmarkName?: string) =>
    rpcRequest.getDefaultPRTitleBody({ workspacePath, bookmarkName }),
  openPR: (workspacePath: string, title: string, body: string, bookmarkName?: string) =>
    rpcRequest.openPR({ workspacePath, bookmarkName, title, body }),
  updatePR: (workspacePath: string) =>
    rpcRequest.updatePR({ workspacePath }),
  getOpenPRState: (workspacePath: string) =>
    rpcRequest.getOpenPRState({ workspacePath }),
  setOpenPRState: (workspacePath: string, prState: any) =>
    rpcRequest.setOpenPRState({ workspacePath, prState }),

  // PR Review
  startPRReview: (repoId: string, prNumber: number) =>
    rpcRequest.startPRReview({ repoId, prNumber }),

  // Assigned PRs
  getAssignedPRs: () => rpcRequest.getAssignedPRs(),

  // PR Feedback
  getPRMonitorStatus: (workspacePath: string) =>
    rpcRequest.getPRMonitorStatus({ workspacePath }),
  startPRMonitor: (params: {
    workspacePath: string;
    prNumber: number;
    prURL: string;
    owner: string;
    repo: string;
  }) => rpcRequest.startPRMonitor(params),
  stopPRMonitor: (workspacePath: string) =>
    rpcRequest.stopPRMonitor({ workspacePath }),
  getPRDrafts: (workspacePath: string) =>
    rpcRequest.getPRDrafts({ workspacePath }),
  approveDraft: (draftId: string) =>
    rpcRequest.approveDraft({ draftId }),
  dismissDraft: (draftId: string, abandon: boolean) =>
    rpcRequest.dismissDraft({ draftId, abandon }),
  pollNow: (workspacePath: string) =>
    rpcRequest.pollNow({ workspacePath }),
  getLastPoll: (workspacePath: string) =>
    rpcRequest.getLastPoll({ workspacePath }),
  updateDraftText: (draftId: string, text: string) =>
    rpcRequest.updateDraftText({ draftId, text }),

  // VCS Commit View
  getVCSStatus: (workspacePath: string) =>
    rpcRequest.getVCSStatus({ workspacePath }),
  vcsStageFiles: (workspacePath: string, paths: string[]) =>
    rpcRequest.vcsStageFiles({ workspacePath, paths }),
  vcsUnstageFiles: (workspacePath: string, paths: string[]) =>
    rpcRequest.vcsUnstageFiles({ workspacePath, paths }),
  vcsStageAll: (workspacePath: string) =>
    rpcRequest.vcsStageAll({ workspacePath }),
  vcsUnstageAll: (workspacePath: string) =>
    rpcRequest.vcsUnstageAll({ workspacePath }),
  vcsCommit: (workspacePath: string, message: string, amend: boolean) =>
    rpcRequest.vcsCommit({ workspacePath, message, amend }),
  vcsPush: (workspacePath: string) =>
    rpcRequest.vcsPush({ workspacePath }),
  vcsGetFileDiff: (workspacePath: string, filePath: string, staged: boolean) =>
    rpcRequest.vcsGetFileDiff({ workspacePath, filePath, staged }),

  // JJ (Jujutsu) VCS View
  jjLog: (workspacePath: string, revset?: string) =>
    rpcRequest.jjLog({ workspacePath, revset }),
  jjNew: (workspacePath: string, revisions?: string[]) =>
    rpcRequest.jjNew({ workspacePath, revisions }),
  jjFetch: (workspacePath: string, remote?: string, allRemotes?: boolean) =>
    rpcRequest.jjFetch({ workspacePath, remote, allRemotes }),
  jjPush: (workspacePath: string, bookmark?: string, allTracked?: boolean) =>
    rpcRequest.jjPush({ workspacePath, bookmark, allTracked }),
  jjUndo: (workspacePath: string) =>
    rpcRequest.jjUndo({ workspacePath }),
  jjDescribe: (workspacePath: string, revision: string, description: string) =>
    rpcRequest.jjDescribe({ workspacePath, revision, description }),
  jjAbandon: (workspacePath: string, revision: string) =>
    rpcRequest.jjAbandon({ workspacePath, revision }),
  jjGetChangedFiles: (workspacePath: string, revision: string) =>
    rpcRequest.jjGetChangedFiles({ workspacePath, revision }),
  jjGetFileDiff: (workspacePath: string, revision: string, filePath: string) =>
    rpcRequest.jjGetFileDiff({ workspacePath, revision, filePath }),
  jjGetBookmarks: (workspacePath: string) =>
    rpcRequest.jjGetBookmarks({ workspacePath }),
  jjEdit: (workspacePath: string, revision: string) =>
    rpcRequest.jjEdit({ workspacePath, revision }),
  jjBookmarkSet: (workspacePath: string, revision: string, name: string, track: boolean) =>
    rpcRequest.jjBookmarkSet({ workspacePath, revision, name, track }),
  jjRebase: (workspacePath: string, revision: string, destination: string) =>
    rpcRequest.jjRebase({ workspacePath, revision, destination }),

  // HTTP Remote Control Server
  startHttpServer: (params: { enabled: boolean; port: number; hostname: string; token: string }) =>
    rpcRequest.startHttpServer(params),
  stopHttpServer: () => rpcRequest.stopHttpServer(),
  getHttpServerStatus: () => rpcRequest.getHttpServerStatus(),
  getNetworkInterfaces: () => rpcRequest.getNetworkInterfaces(),
  consumePendingPrompt: (workspacePath: string) =>
    rpcRequest.consumePendingPrompt({ workspacePath }),
};
