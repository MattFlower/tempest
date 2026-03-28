// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// Each stream adds its handlers to the appropriate section.
// ============================================================

import { BrowserWindow, BrowserView, ApplicationMenu } from "electrobun/bun";

// --- listFiles implementation ---

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
      getBookmarks: (_params: any) => [],
      addBookmark: (_params: any) => {},
      removeBookmark: (_params: any) => {},

      // --- Session State (Stream D) ---
      loadSessionState: () => null,
      savePaneState: (_params: any) => {},

      // --- Files (Stream E) ---
      listFiles: async (params: any) => {
        return listFilesInDir((params as { workspacePath: string }).workspacePath);
      },
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

// --- Application Menu (Stream E) ---
ApplicationMenu.setApplicationMenu([
  {
    label: "Tempest",
    submenu: [
      { role: "about" },
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

// Forward menu actions to the webview
ApplicationMenu.on("application-menu-clicked", (event: any) => {
  const action = event?.action ?? event?.data?.action;
  if (action && typeof action === "string") {
    (rpc.send as any).menuAction({ action });
  }
});

console.log("[main] Tempest started");
