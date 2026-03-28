// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// Each stream adds its handlers to the appropriate section.
// ============================================================

import { BrowserWindow, BrowserView } from "electrobun/bun";
import { BookmarkManager } from "./browser/bookmark-manager";

// Cache BookmarkManagers per repoPath to avoid re-reading disk on every call
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
      createTerminal: (_params: any) => ({ success: false, error: "Not implemented" }),
      resizeTerminal: (_params: any) => {},
      killTerminal: (_params: any) => {},
      buildClaudeCommand: (_params: any) => ({ command: [], settingsPath: undefined }),
      buildShellCommand: (_params: any) => ({ command: [] }),

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
      writeToTerminal: (_msg: any) => {},

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

console.log("[main] Tempest started");
