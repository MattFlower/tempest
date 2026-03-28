// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// Each stream adds its handlers to the appropriate section.
// ============================================================

import { BrowserWindow, BrowserView } from "electrobun/bun";
import { PtyManager } from "./pty-manager";
import { SessionManager } from "./session-manager";
import { BookmarkManager } from "./browser/bookmark-manager";

// --- Stream A: Terminal + Session ---
const ptyManager = new PtyManager();
const sessionManager = new SessionManager({
  workspaceRoot: "~/tempest/workspaces",
  claudeArgs: ["--dangerously-skip-permissions"],
});

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

// Define RPC with handler stubs — each stream fills in its section
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

      // --- Repos & Workspaces (Stream D) ---
      getRepos: () => [],
      addRepo: (_params: any) => ({ success: false, error: "Not implemented" }),
      removeRepo: (_params: any) => {},
      getWorkspaces: (_params: any) => [],
      createWorkspace: (_params: any) => ({ success: false, error: "Not implemented" }),
      archiveWorkspace: (_params: any) => ({ success: false, error: "Not implemented" }),
      refreshWorkspaces: (_params: any) => [],

      // --- Sidebar (Stream D) ---
      getSidebarInfo: (_params: any) => ({}),
      getVCSType: (_params: any) => "git",

      // --- Config (Stream D) ---
      getConfig: () => ({
        workspaceRoot: "~/tempest/workspaces",
        claudeArgs: ["--dangerously-skip-permissions"],
      }),
      saveConfig: (_params: any) => {},

      // --- Bookmarks (Stream C) ---
      getBookmarks: async ({ repoPath }: { repoPath: string }) =>
        getBookmarkManager(repoPath).getAll(),
      addBookmark: async ({ repoPath, url, label }: { repoPath: string; url: string; label: string }) => {
        await getBookmarkManager(repoPath).add(url, label);
      },
      removeBookmark: async ({ repoPath, bookmarkId }: { repoPath: string; bookmarkId: string }) => {
        await getBookmarkManager(repoPath).remove(bookmarkId);
      },

      // --- Session State (Stream D) ---
      loadSessionState: () => null,
      savePaneState: (_params: any) => {},

      // --- Files (Stream E) ---
      listFiles: (_params: any) => [],
    },
    messages: {
      // --- Terminal I/O (Stream A) ---
      writeToTerminal: (msg: any) => {
        ptyManager.write(msg.id, msg.data);
      },

      // --- Pane state sync (Stream B) ---
      paneTreeChanged: (_msg: any) => {},

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

// Wire PTY output/exit to webview
ptyManager.onOutput((id, data, seq) => {
  win.webview.rpc.send.terminalOutput({ id, data, seq });
});

ptyManager.onExit((id, exitCode) => {
  win.webview.rpc.send.terminalExit({ id, exitCode });
});

// Clean up PTY processes on exit
process.on("exit", () => {
  ptyManager.killAll();
});

console.log("[main] Tempest started");
