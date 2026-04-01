// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// All 5 streams integrated.
// ============================================================

import { BrowserWindow, BrowserView, ApplicationMenu, Utils } from "electrobun/bun";
import { PtyManager } from "./pty-manager";
import { SessionManager } from "./session-manager";
import { BookmarkManager } from "./browser/bookmark-manager";
import { WorkspaceManager } from "./workspace-manager";
import { SessionStateManager } from "./session-state-manager";
import { HookEventListener } from "./hooks/hook-event-listener";
import { SessionActivityTracker } from "./hooks/session-activity-tracker";

import { loadConfig, saveConfig as saveConfigFile, defaultConfig } from "./config/app-config";
import { getUsageData } from "./usage/usage-service";
import { HistoryStore } from "./history/history-store";
import {
  readMarkdownFile,
  watchMarkdownFile,
  unwatchMarkdownFile,
  unwatchAll as unwatchAllMarkdown,
} from "./markdown/markdown-service";
import { getDiff } from "./diff/diff-provider";
import { buildEditorCommand } from "./editor/editor-command";
import { readFileForEditor, writeFileForEditor, resolveModulePath } from "./editor/file-service";
import { AIContextProvider } from "./diff/ai-context-provider";
import { PRMonitor } from "./pr/pr-monitor";
import { lookupPRUrl } from "./pr/pr-url-lookup";

// --- Stream A: Terminal + Session ---
const ptyManager = new PtyManager();
// SessionManager starts with defaults, updated with real config after async load
const sessionManager = new SessionManager(defaultConfig());

// --- Stream C: Bookmark Managers ---
const bookmarkManagers = new Map<string, BookmarkManager>();
function getBookmarkManager(repoPath: string): BookmarkManager {
  let mgr = bookmarkManagers.get(repoPath);
  if (!mgr) {
    mgr = new BookmarkManager(repoPath);
    bookmarkManagers.set(repoPath, mgr);
  }
  return mgr;
}

// --- Stream D: Backend Managers ---
const workspaceManager = new WorkspaceManager();
const sessionStateManager = new SessionStateManager();
const hookListener = new HookEventListener();
const activityTracker = new SessionActivityTracker();

// --- Stream G: History ---
const historyStore = new HistoryStore();
const aiContextProvider = new AIContextProvider(historyStore);

// --- Stream H: PR Feedback ---
const prMonitor = new PRMonitor();

// --- Stream E: listFiles ---
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".jj", "dist", "build", ".next",
  ".cache", ".turbo", "coverage", "__pycache__", ".venv",
  "target", ".idea", ".vscode",
]);

async function listFilesInDir(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const glob = new Bun.Glob("**/*");
    for await (const entry of glob.scan({
      cwd: dirPath,
      onlyFiles: true,
      dot: false,
      followSymlinks: false,
    })) {
      const parts = entry.split("/");
      if (parts.some((p) => IGNORE_DIRS.has(p))) continue;
      results.push(`${dirPath}/${entry}`);
      if (results.length >= 5000) break;
    }
  } catch (e) {
    console.error("[listFiles] error:", e);
  }
  return results;
}

// Define RPC — all streams' handlers combined
const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      // --- Terminal (Stream A) ---
      createTerminal: (params: any) => ptyManager.create(params),
      resizeTerminal: (params: any) => {
        ptyManager.resize(params.id, params.cols, params.rows);
      },
      killTerminal: (params: any) => {
        ptyManager.kill(params.id);
      },
      buildClaudeCommand: (params: any) => sessionManager.buildClaudeCommand(params),
      buildShellCommand: (params: any) => sessionManager.buildShellCommand(params),
      buildEditorCommand: async (params: any) => {
        const config = await loadConfig();
        const editor = config.editor ?? "nvim";
        if (editor === "monaco") {
          throw new Error("Monaco editor is handled in the webview — buildEditorCommand should not be called");
        }
        return buildEditorCommand(editor, params.filePath, params.lineNumber);
      },

      // --- Repos & Workspaces (Stream D) ---
      getRepos: () => workspaceManager.getRepos(),
      addRepo: async (_params: any) => {
        return await workspaceManager.addRepo(_params.path);
      },
      removeRepo: (_params: any) => {
        workspaceManager.removeRepo(_params.repoId);
      },
      getBranches: async (_params: any) => {
        return await workspaceManager.getBranches(_params.repoId);
      },
      getWorkspaces: (_params: any) => {
        return workspaceManager.getWorkspaces(_params.repoId);
      },
      createWorkspace: async (_params: any) => {
        return await workspaceManager.createWorkspace(
          _params.repoId,
          _params.name,
          _params.branch,
          _params.useExistingBranch,
        );
      },
      archiveWorkspace: async (_params: any) => {
        const result = await workspaceManager.archiveWorkspace(_params.workspaceId);
        if (result.success) await sessionStateManager.flush();
        return result;
      },
      refreshWorkspaces: async (_params: any) => {
        return await workspaceManager.refreshWorkspaces(_params.repoId);
      },

      // --- Sidebar (Stream D) ---
      getSidebarInfo: async (_params: any) => {
        return await workspaceManager.getSidebarInfo(_params.workspacePath);
      },
      getVCSType: (_params: any) => {
        return workspaceManager.getVCSType(_params.repoPath);
      },

      // --- Config (Stream D) ---
      getConfig: () => workspaceManager.getConfig(),
      saveConfig: async (_params: any) => {
        await workspaceManager.saveConfig(_params);
      },

      // --- Repo Settings ---
      getRepoSettings: (_params: any) => {
        return workspaceManager.getRepoSettings(_params.repoPath);
      },
      saveRepoSettings: async (_params: any) => {
        await workspaceManager.saveRepoSettings(_params.repoPath, _params.settings);
      },
      testPrepareScript: async (_params: any) => {
        return await workspaceManager.runPrepareScript(_params.script, _params.repoPath);
      },

      // --- Bookmarks (Stream C) ---
      getBookmarks: async ({ repoPath }: { repoPath: string }) =>
        getBookmarkManager(repoPath).getAll(),
      addBookmark: async ({ repoPath, url, label }: { repoPath: string; url: string; label: string }) => {
        await getBookmarkManager(repoPath).add(url, label);
      },
      removeBookmark: async ({ repoPath, bookmarkId }: { repoPath: string; bookmarkId: string }) => {
        await getBookmarkManager(repoPath).remove(bookmarkId);
      },
      updateBookmark: async ({ repoPath, bookmarkId, label, url }: { repoPath: string; bookmarkId: string; label: string; url?: string }) => {
        await getBookmarkManager(repoPath).update(bookmarkId, label, url);
      },

      // --- Session State (Stream D) ---
      loadSessionState: async () => {
        return await sessionStateManager.load();
      },
      savePaneState: (_params: any) => {
        sessionStateManager.savePaneState(_params.workspacePath, _params.paneTree);
        sessionStateManager.setSelectedWorkspacePath(_params.workspacePath);
      },

      // --- Files (Stream E) ---
      listFiles: async (params: any) => {
        return listFilesInDir((params as { workspacePath: string }).workspacePath);
      },

      // --- Onboarding (Stream F) ---
      checkBinaries: () => {
        const config = workspaceManager.getConfig();
        const resolve = (name: string, configuredPath?: string) =>
          configuredPath ? Bun.which(configuredPath) !== null : Bun.which(name) !== null;
        return {
          git: resolve("git", config.gitPath),
          jj: resolve("jj", config.jjPath),
          claude: resolve("claude", config.claudePath),
          gh: resolve("gh", config.ghPath),
        };
      },
      setWorkspaceRoot: async (_params: any) => {
        const { path } = _params as { path: string };
        const config = workspaceManager.getConfig();
        const updated = { ...config, workspaceRoot: path };
        await workspaceManager.saveConfig(updated);
      },
      browseDirectory: async (_params: any) => {
        const { startingFolder } = (_params ?? {}) as { startingFolder?: string };
        const home = Bun.env.HOME ?? "/";
        const resolved = (startingFolder || "~/").replace(/^~(?=\/|$)/, home);
        const paths = await Utils.openFileDialog({
          startingFolder: resolved,
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return { path: paths.length > 0 ? paths[0] : null };
      },

      // --- Usage Tracking (Stream F) ---
      getUsageData: async (_params: any) => {
        return await getUsageData(_params?.since);
      },

      // --- History (Stream G) ---
      getHistorySessions: async (params: any) => {
        return historyStore.getSessions(params.scope, params.projectPath);
      },
      searchHistory: async (params: any) => {
        return historyStore.searchSessions(params.query, params.scope, params.projectPath);
      },
      getSessionMessages: async (params: any) => {
        return historyStore.getMessages(params.sessionFilePath);
      },
      isHistorySearchAvailable: async () => {
        return historyStore.isSearchAvailable;
      },

      // --- Markdown (Feature 4) ---
      readMarkdownFile: async (params: any) => {
        return readMarkdownFile(params.filePath);
      },
      watchMarkdownFile: (params: any) => {
        watchMarkdownFile(params.filePath, (filePath, content, deleted) => {
          try {
            win.webview.rpc.send.markdownFileChanged({ filePath, content, deleted });
          } catch { /* webview not ready yet */ }
        });
      },
      unwatchMarkdownFile: (params: any) => {
        unwatchMarkdownFile(params.filePath);
      },

      // --- File operations (for Monaco editor) ---
      readFileForEditor: async (params: any) => {
        return await readFileForEditor(params.filePath);
      },
      writeFileForEditor: async (params: any) => {
        await writeFileForEditor(params.filePath, params.content);
      },
      resolveModulePath: (params: any) => {
        return resolveModulePath(params.specifier, params.fromFilePath);
      },

      // --- Diff Viewer (Feature 1) ---
      getDiff: async (params: any) => {
        return await getDiff(params.workspacePath, params.scope, params.contextLines, params.commitRef);
      },
      getAIContextForFile: async (params: any) => {
        return await aiContextProvider.contextForFile(params.filePath, params.projectPath);
      },
      getAITimelineForFile: async (params: any) => {
        return await aiContextProvider.timelineForFile(params.filePath, params.projectPath);
      },

      // --- PR URL Lookup ---
      lookupPRUrl: async (params: any) => {
        return await lookupPRUrl(params.workspacePath);
      },

      // --- PR Feedback (Feature 3) ---
      getPRMonitorStatus: (params: any) => {
        const config = prMonitor.getMonitorConfig(params.workspacePath);
        if (!config) return null;
        return {
          monitoring: true as const,
          prNumber: config.prNumber,
          prURL: config.prURL,
          owner: config.owner,
          repo: config.repo,
        };
      },
      startPRMonitor: async (params: any) => {
        await prMonitor.startMonitor({
          workspacePath: params.workspacePath,
          prNumber: params.prNumber,
          prURL: params.prURL,
          owner: params.owner,
          repo: params.repo,
        });
      },
      stopPRMonitor: (params: any) => {
        prMonitor.stopMonitor(params.workspacePath);
      },
      getPRDrafts: (params: any) => {
        return prMonitor.getDrafts(params.workspacePath);
      },
      approveDraft: async (params: any) => {
        return await prMonitor.approveDraft(params.draftId);
      },
      dismissDraft: (params: any) => {
        prMonitor.dismissDraft(params.draftId, params.abandon);
      },
      pollNow: async (params: any) => {
        await prMonitor.pollNow(params.workspacePath);
      },
      getLastPoll: (params: any) => {
        return prMonitor.getLastPoll(params.workspacePath);
      },
      updateDraftText: (params: any) => {
        prMonitor.updateDraftText(params.draftId, params.text);
      },
    },
    messages: {
      // --- Terminal I/O (Stream A) ---
      writeToTerminal: (msg: any) => {
        ptyManager.write(msg.id, msg.data);
      },

      // --- Pane state sync (Stream B + D) ---
      paneTreeChanged: (_msg: any) => {
        sessionStateManager.savePaneState(_msg.workspacePath, _msg.tree);
        sessionStateManager.setSelectedWorkspacePath(_msg.workspacePath);
      },

      // --- Stats (optional) ---
      saveLatencyStats: (_msg: any) => {},
    },
  },
});

// Create the main window
const win = new BrowserWindow({
  title: "Tempest",
  url: "views://main/index.html",
  frame: { width: 1400, height: 900, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
  rpc,
});

// --- Stream A: Wire PTY output/exit to webview ---
ptyManager.onOutput((id, data, seq) => {
  win.webview.rpc.send.terminalOutput({ id, data, seq });
});

ptyManager.onExit((id, exitCode) => {
  win.webview.rpc.send.terminalExit({ id, exitCode });
});

// --- Stream D: Wire push notifications ---
workspaceManager.onWorkspacesChanged = (repoId, workspaces) => {
  try {
    win.webview.rpc.send.workspacesChanged({ repoId, workspaces });
  } catch { /* webview not ready yet */ }
};
workspaceManager.onSidebarInfoUpdated = (workspacePath, info) => {
  try {
    win.webview.rpc.send.sidebarInfoUpdated({ workspacePath, info });
  } catch { /* webview not ready yet */ }
};
workspaceManager.onConfigChanged = (config) => {
  try {
    win.webview.rpc.send.configChanged(config);
  } catch { /* webview not ready yet */ }
};

// --- Stream H: Wire PR feedback push notifications ---
prMonitor.onDraftsChanged = (workspacePath) => {
  try {
    const drafts = prMonitor.getDrafts(workspacePath);
    win.webview.rpc.send.prDraftsChanged({ workspacePath, drafts });
  } catch { /* webview not ready yet */ }
};

// --- Stream E: Application Menu ---
ApplicationMenu.setApplicationMenu([
  {
    label: "Tempest",
    submenu: [
      { role: "about" },
      { label: "Settings...", action: "settings", accelerator: "Cmd+," },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "File",
    submenu: [
      { label: "New Workspace", action: "new-workspace", accelerator: "Cmd+N" },
      { label: "Add Repository...", action: "add-repo", accelerator: "Cmd+O" },
      { label: "Open File...", action: "open-file", accelerator: "Cmd+P" },
      { type: "separator" },
      { role: "close" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      { label: "Toggle Sidebar", action: "toggle-sidebar", accelerator: "Cmd+\\" },
      { label: "Command Palette", action: "command-palette", accelerator: "Cmd+Shift+P" },
      { type: "separator" },
      { label: "Terminal", action: "view-terminal", accelerator: "Cmd+1" },
      { label: "Diff", action: "view-diff", accelerator: "Cmd+2" },
      { label: "Dashboard", action: "view-dashboard", accelerator: "Cmd+3" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "bringAllToFront" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (event: any) => {
  const action = event?.action ?? event?.data?.action;
  if (action && typeof action === "string") {
    (rpc.send as any).menuAction({ action });
  }
});

// --- Async initialization ---
(async () => {
  // Load config and update SessionManager
  try {
    const config = await loadConfig();
    sessionManager.updateConfig(config);
    console.log("[main] Config loaded:", config.workspaceRoot, "claudeArgs:", config.claudeArgs);
  } catch (err) {
    console.error("[main] Config load failed, using defaults:", err);
  }

  try {
    await workspaceManager.initialize();
    console.log("[main] WorkspaceManager initialized");
  } catch (err) {
    console.error("[main] WorkspaceManager init failed:", err);
  }

  try {
    hookListener.start((event) => {
      activityTracker.handleEvent(event);
      try {
        win.webview.rpc.send.hookEvent(event);
      } catch { /* webview not ready yet */ }

      // Push aggregated activity state for the workspace this event belongs to
      if (event.cwd) {
        const pids = activityTracker.pidsForCWD(event.cwd);
        const state = activityTracker.aggregateState(pids);
        try {
          win.webview.rpc.send.workspaceActivityChanged({
            workspacePath: event.cwd,
            activityState: state ?? null,
            pid: event.pid,
          });
        } catch { /* webview not ready yet */ }
      }
    });
  } catch (err) {
    console.error("[main] HookEventListener start failed:", err);
  }

  activityTracker.startCleanupTimer();
  sessionStateManager.startAutoSave();

  try {
    await historyStore.initialize();
    historyStore.startRefreshTimer();
    console.log("[main] HistoryStore initialized");
  } catch (err) {
    console.error("[main] HistoryStore init failed:", err);
  }
})();

// --- Shutdown cleanup (Stream A + D) ---
async function shutdown() {
  console.log("[main] Shutting down...");
  ptyManager.killAll();
  await sessionStateManager.flush();
  sessionStateManager.stopAutoSave();
  hookListener.stop();
  activityTracker.stopCleanupTimer();
  workspaceManager.stopSidebarRefresh();
  historyStore.stopRefreshTimer();
  unwatchAllMarkdown();
  prMonitor.shutdown();
}

process.on("SIGINT", () => { shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { shutdown().then(() => process.exit(0)); });
process.on("beforeExit", async () => { await shutdown(); });

console.log("[main] Tempest started");
