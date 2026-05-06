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
      if (sorted.length > 0) {
        nextExpectedSeq.set(id, sorted[sorted.length - 1] + 1);
      }
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

/**
 * Walk a PaneNode tree and return a new tree with the sessionId updated on the tab
 * matching the given terminalId. Returns `null` when no update is needed — either
 * because no tab matched, or because the matching tab already has this sessionId
 * (idempotent — repeated sessionIdResolved events for the same value are zero-cost).
 * Preserves reference identity on all unchanged subtrees so Zustand's shallow
 * reference checks skip unaffected panes.
 */
function updateTabSessionId(node: any, terminalId: string, sessionId: string): any | null {
  if (!node) return null;
  if (node.type === "leaf" && node.pane?.tabs) {
    const tabs = node.pane.tabs;
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (tab.terminalId === terminalId) {
        if (tab.sessionId === sessionId) {
          // Idempotent: the tab already has this sessionId, no change needed.
          return null;
        }
        const newTabs = tabs.slice();
        newTabs[i] = { ...tab, sessionId };
        const newPane = { ...node.pane, tabs: newTabs };
        return { ...node, pane: newPane };
      }
    }
    return null;
  }
  if (node.type === "split" && node.children) {
    const children = node.children;
    let newChildren: any[] | null = null;
    for (let i = 0; i < children.length; i++) {
      const updated = updateTabSessionId(children[i], terminalId, sessionId);
      if (updated !== null) {
        if (newChildren === null) newChildren = children.slice();
        newChildren[i] = updated;
      }
    }
    if (newChildren === null) return null;
    return { ...node, children: newChildren };
  }
  return null;
}

/**
 * Shared create-or-update path for the three "show something in a browser
 * pane" MCP tools (show_webpage, show_mermaid_diagram, show_markdown). All
 * three write an HTML file to a stable, id-based path on disk; the filename
 * encodes the caller's id so updates overwrite in place. Here we scan the
 * workspace's pane tree for a pane already bound to that id and, if found,
 * reload the mounted webview rather than spawn a new pane — so Claude can
 * iterate on content without cluttering the UI.
 */
async function upsertPreviewPane(params: {
  workspacePath: string;
  title: string;
  filePath: string;
  id: string;
  /** Which PaneTab field stores the id. Must also match an optional field on PaneTab. */
  idField: "webpageId" | "mermaidDiagramId" | "markdownId";
}) {
  const [{ useStore }, paneNode, { PaneTabKind }] = await Promise.all([
    import("./store"),
    import("../models/pane-node"),
    import("../../../shared/ipc-types"),
  ]);

  const store = useStore.getState();
  const tree = store.paneTrees[params.workspacePath];
  if (!tree) return;

  // Cache buster: the filename is stable (so updates overwrite on disk),
  // but WKWebView caches file:// URLs aggressively. Appending a timestamp
  // forces a fresh navigation.
  const reloadURL = `file://${params.filePath}?v=${Date.now()}`;

  // Scan only the tree for the caller's workspace. If a pane with this id
  // exists in a *different* workspace we leave it alone and create a new
  // pane here — changing workspaces mid-flight is surprising.
  const panes = paneNode.allPanes(tree);
  let foundPaneId: string | undefined;
  let foundTabId: string | undefined;
  for (const pane of panes) {
    const tab = pane.tabs.find((t: any) => t[params.idField] === params.id);
    if (tab) {
      foundPaneId = pane.id;
      foundTabId = tab.id;
      break;
    }
  }

  if (foundPaneId && foundTabId) {
    // Update branch: rewrite the tab's browserURL in place and imperatively
    // tell the mounted <electrobun-webview> to navigate. Updating
    // browserURL alone isn't enough — BrowserPane only consumes `src` at
    // mount time.
    const newTree = paneNode.updatingPane(tree, foundPaneId, (pane: any) => ({
      ...pane,
      tabs: pane.tabs.map((t: any) =>
        t.id === foundTabId ? { ...t, browserURL: reloadURL, label: params.title } : t,
      ),
      selectedTabId: foundTabId,
    }));
    store.setPaneTree(params.workspacePath, newTree);
    store.setFocusedPaneId(foundPaneId);

    try {
      const el = document.getElementById(`browser-${foundTabId}`) as any;
      el?.loadURL?.(reloadURL);
    } catch { /* webview not mounted yet */ }

    const { api } = await import("./rpc-client");
    api.notifyPaneTreeChanged(params.workspacePath, paneNode.toNodeState(newTree));
    return;
  }

  // Create branch: new pane stamped with the id so a future update can find it.
  const afterPaneId = store.focusedPaneId ?? panes[0]?.id;
  if (!afterPaneId) return;

  if (store.selectedWorkspacePath !== params.workspacePath) {
    store.selectWorkspace(params.workspacePath);
  }

  const tab = paneNode.createTab(PaneTabKind.Browser, params.title, {
    browserURL: reloadURL,
    [params.idField]: params.id,
  });
  const newPane = paneNode.createPane(tab);
  const newTree = paneNode.addingPane(tree, newPane, afterPaneId);
  store.setPaneTree(params.workspacePath, newTree);
  store.setFocusedPaneId(newPane.id);

  const { api } = await import("./rpc-client");
  api.notifyPaneTreeChanged(params.workspacePath, paneNode.toNodeState(newTree));
}

/**
 * Open a URL in a new Browser pane, split after the pane owning the
 * originating terminal. Used by Cmd+click in terminal panes. Falls back to
 * the currently-selected workspace + focused pane if the terminalId can't
 * be located (defensive — shouldn't happen in practice).
 */
export async function openUrlInNewBrowserPane(
  url: string,
  originTerminalId?: string,
) {
  const [{ useStore }, paneNode, { PaneTabKind }] = await Promise.all([
    import("./store"),
    import("../models/pane-node"),
    import("../../../shared/ipc-types"),
  ]);

  const store = useStore.getState();

  let targetWorkspacePath: string | undefined;
  let afterPaneId: string | undefined;

  if (originTerminalId) {
    for (const [wsPath, tree] of Object.entries(store.paneTrees)) {
      for (const pane of paneNode.allPanes(tree as any)) {
        if (pane.tabs.some((t: any) => t.terminalId === originTerminalId)) {
          targetWorkspacePath = wsPath;
          afterPaneId = pane.id;
          break;
        }
      }
      if (targetWorkspacePath) break;
    }
  }

  if (!targetWorkspacePath) {
    targetWorkspacePath = store.selectedWorkspacePath ?? undefined;
    if (!targetWorkspacePath) return;
    const fallbackTree = store.paneTrees[targetWorkspacePath];
    if (!fallbackTree) return;
    afterPaneId =
      store.focusedPaneId ?? paneNode.allPanes(fallbackTree as any)[0]?.id;
  }

  if (!targetWorkspacePath || !afterPaneId) return;
  const tree = store.paneTrees[targetWorkspacePath];
  if (!tree) return;

  let label = url;
  try {
    label = new URL(url).host || url;
  } catch { /* keep full url as label */ }

  const tab = paneNode.createTab(PaneTabKind.Browser, label, {
    browserURL: url,
  });
  const newPane = paneNode.createPane(tab);
  const newTree = paneNode.addingPane(tree, newPane, afterPaneId);

  if (store.selectedWorkspacePath !== targetWorkspacePath) {
    store.selectWorkspace(targetWorkspacePath);
  }
  store.setPaneTree(targetWorkspacePath, newTree);
  store.setFocusedPaneId(newPane.id);

  api.notifyPaneTreeChanged(targetWorkspacePath, paneNode.toNodeState(newTree));
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
        Promise.all([
          import("./store"),
          import("../models/pane-node"),
        ]).then(([{ useStore }, paneNode]) => {
          const store = useStore.getState();
          // Find the tab with this terminalId across all workspace pane trees and update its sessionId.
          // updateTabSessionId returns a new tree (preserving identity on unchanged subtrees) on a real
          // change, or null if no match OR if the matching tab already has this sessionId (idempotent).
          for (const [wsPath, tree] of Object.entries(store.paneTrees)) {
            const newTree = updateTabSessionId(tree as any, msg.terminalId, msg.sessionId);
            if (newTree === null) continue;
            store.setPaneTree(wsPath, newTree);
            // Persist the new sessionId immediately. Claude has a backend
            // safety net (enrichTreeWithSessionIds scans ~/.claude/sessions/
            // on the next paneTreeChanged), but Pi has no such fallback —
            // if we don't notify here, the resolved path could be lost.
            api.notifyPaneTreeChanged(
              wsPath,
              paneNode.toNodeState(newTree),
              true,
            );
            break;
          }
        });
      },
      hookEvent: (event: WebviewMessages["hookEvent"]) => {
        hookEventHandler?.(event);
      },
      workspaceActivityChanged: (msg: any) => {
        import("./store").then(({ useStore }) => {
          const store = useStore.getState();
          if (msg.activityState !== null && msg.activityState !== undefined) {
            store.setWorkspaceActivity(msg.workspacePath, msg.activityState);
          } else {
            store.clearWorkspaceActivity(msg.workspacePath);
          }
        });
      },
      workspacesChanged: (msg: WebviewMessages["workspacesChanged"]) => {
        // Handled by store subscription — imported dynamically to avoid circular deps
        import("./store").then(({ useStore }) => {
          useStore.getState().setWorkspaces(msg.repoId, msg.workspaces);
        });
      },
      workspaceRenamed: (msg: WebviewMessages["workspaceRenamed"]) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().migrateWorkspacePath(msg.oldPath, msg.newPath);
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
      directoryChanged: (msg: any) => {
        import("./store").then(({ useStore }) => {
          const store = useStore.getState();
          const dirPath: string = msg.changedDirPath;
          // If the directory is currently cached, re-fetch its entries (if
          // still expanded) or drop the stale cache (if not expanded). The
          // webview's tree state is the source of truth for "is this dir
          // still visible to the user?".
          const isExpanded = !!store.fileTreeExpandedDirs[dirPath]
            || !!store.fileTreeExpandedWorkspaces[dirPath];
          if (!isExpanded) {
            store.invalidateFileTreeDir(dirPath);
            return;
          }
          // Re-fetch — but only while the Files view is active. If the user
          // has switched away, we've unwatched already, so this is defensive.
          if (store.activeSidebarView !== "files" || !store.sidebarVisible) {
            store.invalidateFileTreeDir(dirPath);
            return;
          }
          api.listDir(dirPath).then((res: any) => {
            if (res?.ok && res.entries) {
              store.setFileTreeEntries(dirPath, res.entries);
            } else if (res?.error) {
              store.setFileTreeError(dirPath, res.error);
            }
          }).catch((err: any) => {
            console.warn("[file-tree] refetch after directoryChanged failed:", err);
          });
        });
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
      showWebpage: (msg: any) => {
        upsertPreviewPane({
          workspacePath: msg.workspacePath,
          title: msg.title,
          filePath: msg.filePath,
          id: msg.pageId,
          idField: "webpageId",
        });
      },
      showMermaidDiagram: (msg: any) => {
        upsertPreviewPane({
          workspacePath: msg.workspacePath,
          title: msg.title,
          filePath: msg.filePath,
          id: msg.diagramId,
          idField: "mermaidDiagramId",
        });
      },
      showMarkdown: (msg: any) => {
        upsertPreviewPane({
          workspacePath: msg.workspacePath,
          title: msg.title,
          filePath: msg.filePath,
          id: msg.markdownId,
          idField: "markdownId",
        });
      },
      lspDiagnostics: (msg: any) => {
        // Lazy-import to keep the diagnostics module out of the rpc-client's
        // immediate dep graph (it touches monaco-editor types).
        import("../components/editor/lsp/lsp-diagnostics").then(({ applyDiagnostics }) => {
          applyDiagnostics(msg.uri, msg.diagnostics);
        });
      },
      lspServerStateChanged: (msg: any) => {
        import("../components/editor/lsp/lsp-store").then(({ useLspStore }) => {
          useLspStore.getState().applyServerState(msg.state);
        });
      },
      lspMemoryUpdate: (msg: any) => {
        import("../components/editor/lsp/lsp-store").then(({ useLspStore }) => {
          useLspStore.getState().applyMemorySamples(msg.samples);
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
            case "view-progress":
              store.setProgressViewActive(!store.progressViewActive);
              break;
            case "view-terminal":
              if (store.progressViewActive) store.setProgressViewActive(false);
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.Terminal);
              }
              break;
            case "view-dashboard":
              if (store.progressViewActive) store.setProgressViewActive(false);
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.Dashboard);
              }
              break;
            case "view-vcs":
              if (store.progressViewActive) store.setProgressViewActive(false);
              if (store.selectedWorkspacePath) {
                store.setViewMode(store.selectedWorkspacePath, ViewMode.VCS);
              }
              break;
            case "toggle-devtools":
              import("./devtools").then(({ toggleDevTools }) => toggleDevTools());
              break;
            case "show-keymap":
              import("../commands/registry").then(({ getCommand }) => {
                getCommand("help.keymap")?.run();
              });
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
    withMcp?: boolean;
    workspaceName?: string;
    planMode?: boolean;
  }) => rpcRequest.buildClaudeCommand(params),

  buildShellCommand: (params: { workspacePath: string }) =>
    rpcRequest.buildShellCommand(params),
  buildPiCommand: (params: { workspacePath: string; sessionPath?: string; resume?: boolean }) =>
    rpcRequest.buildPiCommand(params),
  buildCodexCommand: (params: { workspacePath: string; sessionId?: string; resume?: boolean }) =>
    rpcRequest.buildCodexCommand(params),
  buildEditorCommand: (filePath: string, lineNumber?: number) =>
    rpcRequest.buildEditorCommand({ filePath, lineNumber }),

  // Repos
  getRepos: () => rpcRequest.getRepos(),
  addRepo: (path: string) => rpcRequest.addRepo({ path }),
  removeRepo: (repoId: string) => rpcRequest.removeRepo({ repoId }),
  cloneRepo: (params: { vcsType: string; url: string; localPath: string; colocate?: boolean }) =>
    rpcRequest.cloneRepo(params),

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
  renameWorkspace: (workspaceId: string, newName: string) =>
    rpcRequest.renameWorkspace({ workspaceId, newName }),

  // Sidebar
  getSidebarInfo: (workspacePath: string) =>
    rpcRequest.getSidebarInfo({ workspacePath }),
  getVCSType: (repoPath: string) =>
    rpcRequest.getVCSType({ repoPath }),

  // Config
  getConfig: () => rpcRequest.getConfig(),
  saveConfig: (config: any) => rpcRequest.saveConfig(config),

  // Pi env vars (secrets stored in macOS Keychain)
  listPiEnvVarNames: () => rpcRequest.listPiEnvVarNames(),
  setPiEnvVar: (name: string, value: string) =>
    rpcRequest.setPiEnvVar({ name, value }),
  deletePiEnvVar: (name: string) =>
    rpcRequest.deletePiEnvVar({ name }),

  // Codex env vars (secrets stored in macOS Keychain)
  listCodexEnvVarNames: () => rpcRequest.listCodexEnvVarNames(),
  setCodexEnvVar: (name: string, value: string) =>
    rpcRequest.setCodexEnvVar({ name, value }),
  deleteCodexEnvVar: (name: string) =>
    rpcRequest.deleteCodexEnvVar({ name }),

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
  resolveScriptLaunch: (params: {
    repoPath: string;
    workspacePath: string;
    workspaceName: string;
    script?: string;
    scriptPath?: string;
    paramValues?: Record<string, string>;
  }): Promise<{ command: string[]; cwd: string; env: Record<string, string> }> =>
    rpcRequest.resolveScriptLaunch(params),
  getPackageScripts: (workspacePath: string) =>
    rpcRequest.getPackageScripts({ workspacePath }),
  getMavenScripts: (workspacePath: string) =>
    rpcRequest.getMavenScripts({ workspacePath }),
  getGradleScripts: (workspacePath: string) =>
    rpcRequest.getGradleScripts({ workspacePath }),
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

  // Activity state
  getActivityState: () => rpcRequest.getActivityState(),

  // Session state
  loadSessionState: () => rpcRequest.loadSessionState(),
  savePaneState: (workspacePath: string, paneTree: any) =>
    rpcRequest.savePaneState({ workspacePath, paneTree }),
  setRepoExpanded: (repoId: string, isExpanded: boolean) =>
    rpcRequest.setRepoExpanded({ repoId, isExpanded }),
  setWorkspaceHidden: (workspacePath: string, hidden: boolean) =>
    rpcRequest.setWorkspaceHidden({ workspacePath, hidden }),
  saveFileTreeState: (state: {
    activeSidebarView?: "workspaces" | "files";
    expandedRepoIds?: string[];
    expandedWorkspacePaths?: string[];
    expandedDirs?: string[];
    cursor?: string | null;
    scrollTop?: number;
    showHidden?: boolean;
    autoReveal?: boolean;
  }) => rpcRequest.saveFileTreeState(state),

  // Files
  listFiles: (workspacePath: string) =>
    rpcRequest.listFiles({ workspacePath }),
  getRecentFiles: (workspacePath: string) =>
    rpcRequest.getRecentFiles({ workspacePath }),
  notifyFileOpened: (workspacePath: string, filePath: string) =>
    rpcRequest.notifyFileOpened({ workspacePath, filePath }),
  browsePath: (query: string, workspacePath: string) =>
    rpcRequest.browsePath({ query, workspacePath }),
  findInFiles: (params: {
    workspacePath: string;
    query: string;
    isRegex: boolean;
    caseSensitive: boolean;
    maxResults?: number;
  }) => rpcRequest.findInFiles(params),

  // File tree (sidebar)
  listDir: (dirPath: string, workspacePath?: string) =>
    rpcRequest.listDir({ dirPath, workspacePath }),
  watchDirectoryTree: (workspacePath: string) =>
    rpcRequest.watchDirectoryTree({ workspacePath }),
  unwatchDirectoryTree: (workspacePath: string) =>
    rpcRequest.unwatchDirectoryTree({ workspacePath }),
  unwatchAllDirectoryTrees: () =>
    rpcRequest.unwatchAllDirectoryTrees(),
  revealInFinder: (path: string) =>
    rpcRequest.revealInFinder({ path }),

  // Pane tree sync
  notifyPaneTreeChanged: (workspacePath: string, tree: any, flushNow?: boolean) =>
    rpcSend.paneTreeChanged({ workspacePath, tree, flushNow }),

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
  getHistorySessions: (
    scope: "all" | "project",
    workspacePath?: string,
    provider: "claude" | "pi" | "codex" = "claude",
  ) => rpcRequest.getHistorySessions({ scope, workspacePath, provider }),
  searchHistory: (
    query: string,
    scope: "all" | "project",
    workspacePath?: string,
    provider: "claude" | "pi" | "codex" = "claude",
  ) => rpcRequest.searchHistory({ query, scope, workspacePath, provider }),
  getSessionMessages: (sessionFilePath: string) =>
    rpcRequest.getSessionMessages({ sessionFilePath }),
  isHistorySearchAvailable: (provider: "claude" | "pi" | "codex" = "claude") =>
    rpcRequest.isHistorySearchAvailable({ provider }),
  resolveCodexSessionId: (sessionFilePath: string) =>
    rpcRequest.resolveCodexSessionId({ sessionFilePath }),

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
  readImageFile: (filePath: string) =>
    rpcRequest.readImageFile({ filePath }),
  writeFileForEditor: (filePath: string, content: string) =>
    rpcRequest.writeFileForEditor({ filePath, content }),
  resolveModulePath: (specifier: string, fromFilePath: string) =>
    rpcRequest.resolveModulePath({ specifier, fromFilePath }),

  // AI Context
  getAIContextForFile: (filePath: string, projectPath?: string) =>
    rpcRequest.getAIContextForFile({ filePath, projectPath }),
  getAITimelineForFile: (filePath: string, projectPath?: string) =>
    rpcRequest.getAITimelineForFile({ filePath, projectPath }),

  // Repo URL (GitHub)
  getRepoGitHubUrl: (workspacePath: string) =>
    rpcRequest.getRepoGitHubUrl({ workspacePath }),

  // Progress View
  getProgressData: (forceRefresh?: boolean) =>
    rpcRequest.getProgressData({ forceRefresh }),
  getPRDetail: (repoPath: string, branch: string) =>
    rpcRequest.getPRDetail({ repoPath, branch }),
  notifyWorkspaceOpened: (workspacePath: string) =>
    rpcRequest.notifyWorkspaceOpened({ workspacePath }),

  // PR URL Lookup
  lookupPRUrl: (workspacePath: string) =>
    rpcRequest.lookupPRUrl({ workspacePath }),

  // Open PR
  getDefaultPRTitleBody: (workspacePath: string) =>
    rpcRequest.getDefaultPRTitleBody({ workspacePath }),
  openPR: (workspacePath: string, title: string, body: string, bookmarkName?: string, draft?: boolean) =>
    rpcRequest.openPR({ workspacePath, bookmarkName, title, body, draft }),
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
  refreshAssignedPRs: () => rpcRequest.refreshAssignedPRs(),

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
  vcsRevertFiles: (workspacePath: string, paths: string[]) =>
    rpcRequest.vcsRevertFiles({ workspacePath, paths }),
  vcsCommit: (workspacePath: string, message: string, amend: boolean) =>
    rpcRequest.vcsCommit({ workspacePath, message, amend }),
  vcsPush: (workspacePath: string) =>
    rpcRequest.vcsPush({ workspacePath }),
  vcsGetFileDiff: (workspacePath: string, filePath: string, staged: boolean) =>
    rpcRequest.vcsGetFileDiff({ workspacePath, filePath, staged }),

  // Git Commit/Scope Selection
  gitGetRecentCommits: (workspacePath: string, count?: number) =>
    rpcRequest.gitGetRecentCommits({ workspacePath, count }),
  gitGetScopedFiles: (workspacePath: string, scope: import("../../../shared/ipc-types").DiffScope, commitRef?: string) =>
    rpcRequest.gitGetScopedFiles({ workspacePath, scope, commitRef }),
  gitGetScopedFileDiff: (workspacePath: string, scope: import("../../../shared/ipc-types").DiffScope, filePath: string, commitRef?: string) =>
    rpcRequest.gitGetScopedFileDiff({ workspacePath, scope, filePath, commitRef }),

  // Git Branch / Remote Operations
  gitListBranchesAndRemotes: (workspacePath: string) =>
    rpcRequest.gitListBranchesAndRemotes({ workspacePath }),
  gitPull: (workspacePath: string) =>
    rpcRequest.gitPull({ workspacePath }),
  gitFetchAll: (workspacePath: string) =>
    rpcRequest.gitFetchAll({ workspacePath }),
  gitPushBranch: (workspacePath: string, branch: string, remote: string) =>
    rpcRequest.gitPushBranch({ workspacePath, branch, remote }),
  gitMergeBranch: (workspacePath: string, branch: string) =>
    rpcRequest.gitMergeBranch({ workspacePath, branch }),
  gitRebaseOnto: (workspacePath: string, branch: string) =>
    rpcRequest.gitRebaseOnto({ workspacePath, branch }),

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
  jjGetRestorePreview: (workspacePath: string, targetRevision: string, sourceRevision: string, filePath: string) =>
    rpcRequest.jjGetRestorePreview({ workspacePath, targetRevision, sourceRevision, filePath }),
  jjRestore: (workspacePath: string, targetRevision: string, sourceRevision: string, filePath: string) =>
    rpcRequest.jjRestore({ workspacePath, targetRevision, sourceRevision, filePath }),
  jjGetRangeChangedFiles: (workspacePath: string, fromRevision: string, toRevision: string) =>
    rpcRequest.jjGetRangeChangedFiles({ workspacePath, fromRevision, toRevision }),
  jjGetRangeFileDiff: (workspacePath: string, fromRevision: string, toRevision: string, filePath: string) =>
    rpcRequest.jjGetRangeFileDiff({ workspacePath, fromRevision, toRevision, filePath }),

  // Open In (external editors)
  getInstalledEditors: () => rpcRequest.getInstalledEditors(),
  openInEditor: (editorId: string, directory: string) =>
    rpcRequest.openInEditor({ editorId, directory }),

  // Browser DNS
  resolveDns: (hostname: string) =>
    rpcRequest.resolveDns({ hostname }),

  // HTTP Remote Control Server
  startHttpServer: (params: { enabled: boolean; port: number; hostname: string; token: string }) =>
    rpcRequest.startHttpServer(params),
  stopHttpServer: () => rpcRequest.stopHttpServer(),
  getHttpServerStatus: () => rpcRequest.getHttpServerStatus(),
  getNetworkInterfaces: () => rpcRequest.getNetworkInterfaces(),
  consumePendingPrompt: (workspacePath: string) =>
    rpcRequest.consumePendingPrompt({ workspacePath }),

  // Window controls
  windowClose: () => rpcSend.windowClose(),
  windowMinimize: () => rpcSend.windowMinimize(),
  windowMaximize: () => rpcSend.windowMaximize(),

  // LSP
  lspListServers: () => rpcRequest.lspListServers(),
  lspRestartServer: (serverId: string) => rpcRequest.lspRestartServer({ serverId }),
  lspStopServer: (serverId: string) => rpcRequest.lspStopServer({ serverId }),
  lspGetServerLog: (serverId: string) => rpcRequest.lspGetServerLog({ serverId }),
  lspMemoryWatchStart: () => rpcRequest.lspMemoryWatchStart(),
  lspMemoryWatchStop: () => rpcRequest.lspMemoryWatchStop(),
  lspDidOpen: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }) => rpcRequest.lspDidOpen(params),
  lspDidChange: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }) => rpcRequest.lspDidChange(params),
  lspDidClose: (params: { workspacePath: string; uri: string; languageId: string }) =>
    rpcRequest.lspDidClose(params),
  lspHover: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }) => rpcRequest.lspHover(params),
  lspDefinition: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }) => rpcRequest.lspDefinition(params),
  lspCompletion: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    triggerCharacter?: string;
  }) => rpcRequest.lspCompletion(params),
  lspReferences: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
  }) => rpcRequest.lspReferences(params),
  lspDocumentSymbols: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
  }) => rpcRequest.lspDocumentSymbols(params),
  lspPrepareRename: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }) => rpcRequest.lspPrepareRename(params),
  lspRename: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    newName: string;
  }) => rpcRequest.lspRename(params),
  lspSignatureHelp: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    triggerCharacter?: string;
    isRetrigger: boolean;
  }) => rpcRequest.lspSignatureHelp(params),
  lspInlayHints: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    range: import("../../../shared/ipc-types").LspRange;
  }) => rpcRequest.lspInlayHints(params),
  lspCodeActions: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    range: import("../../../shared/ipc-types").LspRange;
    context: import("../../../shared/ipc-types").LspCodeActionContext;
  }) => rpcRequest.lspCodeActions(params),
  lspExecuteCommand: (params: {
    workspacePath: string;
    languageId: string;
    command: string;
    arguments?: unknown[];
  }) => rpcRequest.lspExecuteCommand(params),
  lspFormatting: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    options: import("../../../shared/ipc-types").LspFormattingOptions;
  }) => rpcRequest.lspFormatting(params),
  lspRangeFormatting: (params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    range: import("../../../shared/ipc-types").LspRange;
    options: import("../../../shared/ipc-types").LspFormattingOptions;
  }) => rpcRequest.lspRangeFormatting(params),
  formatBuffer: (params: {
    filePath: string;
    workspacePath?: string;
    languageId: string;
    content: string;
    options: { tabSize: number; insertSpaces: boolean };
    range?: import("../../../shared/ipc-types").LspRange;
  }) => rpcRequest.formatBuffer(params),
  listFormattersForLanguage: (params: {
    languageId: string;
    filePath?: string;
    workspacePath?: string;
  }) => rpcRequest.listFormattersForLanguage(params),
  resolveSaveConfig: (params: {
    workspacePath?: string;
    languageId: string;
    filePath?: string;
  }) => rpcRequest.resolveSaveConfig(params),
  getEditorconfig: (params: {
    filePath: string;
    workspacePath?: string;
  }) => rpcRequest.getEditorconfig(params),
};
