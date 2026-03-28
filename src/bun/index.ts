// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// Each stream adds its handlers to the appropriate section.
// ============================================================

import { BrowserWindow, BrowserView } from "electrobun/bun";
import { WorkspaceManager } from "./workspace-manager";
import { SessionStateManager } from "./session-state-manager";
import { HookEventListener } from "./hooks/hook-event-listener";
import { SessionActivityTracker } from "./hooks/session-activity-tracker";

// --- Create managers ---
const workspaceManager = new WorkspaceManager();
const sessionStateManager = new SessionStateManager();
const hookListener = new HookEventListener();
const activityTracker = new SessionActivityTracker();

// Define RPC with handler stubs — each stream fills in its section
const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      // --- Terminal (Stream A) ---
      createTerminal: (_params: any) => ({ success: false, error: "Not implemented" }),
      resizeTerminal: (_params: any) => {},
      killTerminal: (_params: any) => {},
      buildClaudeCommand: (_params: any) => ({ command: [], settingsPath: undefined }),
      buildShellCommand: (_params: any) => ({ command: [] }),

      // --- Repos & Workspaces (Stream D) ---
      getRepos: () => workspaceManager.getRepos(),
      addRepo: async (_params: any) => {
        return await workspaceManager.addRepo(_params.path);
      },
      removeRepo: (_params: any) => {
        workspaceManager.removeRepo(_params.repoId);
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
        return await workspaceManager.archiveWorkspace(_params.workspaceId);
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

      // --- Bookmarks (Stream C) ---
      getBookmarks: (_params: any) => [],
      addBookmark: (_params: any) => {},
      removeBookmark: (_params: any) => {},

      // --- Session State (Stream D) ---
      loadSessionState: async () => {
        return await sessionStateManager.load();
      },
      savePaneState: (_params: any) => {
        sessionStateManager.savePaneState(_params.workspacePath, _params.paneTree);
        sessionStateManager.setSelectedWorkspacePath(_params.workspacePath);
      },

      // --- Files (Stream E) ---
      listFiles: (_params: any) => [],
    },
    messages: {
      // --- Terminal I/O (Stream A) ---
      writeToTerminal: (_msg: any) => {},

      // --- Pane state sync (Stream B) ---
      paneTreeChanged: (_msg: any) => {
        sessionStateManager.savePaneState(_msg.workspacePath, _msg.tree);
        sessionStateManager.setSelectedWorkspacePath(_msg.workspacePath);
      },

      // --- Stats (optional, from prototype) ---
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

// --- Wire push notifications ---
workspaceManager.onWorkspacesChanged = (repoId, workspaces) => {
  try {
    (rpc as any).send?.workspacesChanged?.({ repoId, workspaces });
  } catch { /* webview not ready yet */ }
};
workspaceManager.onSidebarInfoUpdated = (workspacePath, info) => {
  try {
    (rpc as any).send?.sidebarInfoUpdated?.({ workspacePath, info });
  } catch { /* webview not ready yet */ }
};
workspaceManager.onConfigChanged = (config) => {
  try {
    (rpc as any).send?.configChanged?.(config);
  } catch { /* webview not ready yet */ }
};

// --- Async initialization ---
(async () => {
  try {
    await workspaceManager.initialize();
    console.log("[main] WorkspaceManager initialized");
  } catch (err) {
    console.error("[main] WorkspaceManager init failed:", err);
  }

  // Start hook listener
  try {
    hookListener.start((event) => {
      activityTracker.handleEvent(event);
      try {
        (rpc as any).send?.hookEvent?.(event);
      } catch { /* webview not ready yet */ }
    });
  } catch (err) {
    console.error("[main] HookEventListener start failed:", err);
  }

  // Start stale PID cleanup
  activityTracker.startCleanupTimer();

  // Start session auto-save
  sessionStateManager.startAutoSave();
})();

// --- Shutdown cleanup ---
async function shutdown() {
  console.log("[main] Shutting down...");
  await sessionStateManager.flush();
  sessionStateManager.stopAutoSave();
  hookListener.stop();
  activityTracker.stopCleanupTimer();
  workspaceManager.stopSidebarRefresh();
}

process.on("SIGINT", () => { shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { shutdown().then(() => process.exit(0)); });
process.on("beforeExit", () => { shutdown(); });

console.log("[main] Tempest started");
