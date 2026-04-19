// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// All 5 streams integrated.
// ============================================================

import { mkdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { VCSType } from "../shared/ipc-types";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { BrowserWindow, BrowserView, ApplicationMenu, Utils } from "electrobun/bun";
import { PtyManager } from "./pty-manager";
import { SessionManager } from "./session-manager";
import { MacKeychain, isValidEnvVarName } from "./keychain";
import { BookmarkManager } from "./browser/bookmark-manager";
import { WorkspaceManager } from "./workspace-manager";
import { SessionStateManager } from "./session-state-manager";
import { HookEventListener } from "./hooks/hook-event-listener";
import { HookSettingsBuilder } from "./hooks/hook-settings-builder";
import { SessionActivityTracker } from "./hooks/session-activity-tracker";
import { McpHttpServer } from "./mcp/mcp-http-server";

import { lookupSessionID, findSessionIDs, lookupPlanPath } from "./session-id-lookup";
import { loadConfig, saveConfig as saveConfigFile, defaultConfig } from "./config/app-config";
import { runMigration } from "./config/migrate";
import { PathResolver } from "./config/path-resolver";
import { TempestHttpServer, generateToken, consumePendingData } from "./http-server";
import { RemoteTerminalHub } from "./remote-terminal-hub";
import { getUsageData } from "./usage/usage-service";
import { HistoryStore } from "./history/history-store";
import { PiHistoryStore } from "./history/pi-history-store";
import { HistoryAggregator } from "./history/history-aggregator";
import {
  readMarkdownFile,
  watchMarkdownFile,
  unwatchMarkdownFile,
  unwatchAll as unwatchAllMarkdown,
} from "./markdown/markdown-service";
import {
  listDir,
  watchDirectoryTree,
  unwatchDirectoryTree,
  unwatchAllDirectoryTrees,
} from "./file-tree/file-tree-service";
import { buildEditorCommand } from "./editor/editor-command";
import { getInstalledEditors, openInEditor } from "./editor/open-in";
import { readFileForEditor, writeFileForEditor, resolveModulePath } from "./editor/file-service";
import { AIContextProvider } from "./ai-context/ai-context-provider";
import { PRMonitor } from "./pr/pr-monitor";
import { lookupPRUrl } from "./pr/pr-url-lookup";
import { getPRDetail, getPRDetailCached, clearPRDetailCache, getWorkspaceMeta, setWorkspaceLastOpened, resolveWorkspaceCreatedAt, resolveSessionPlanPath } from "./pr/pr-detail";
import { getDefaultTitleAndBody, openPR as openPRAction, updatePR as updatePRAction } from "./pr/pr-open";
import { getAssignedPRs, refreshAssignedPRs } from "./pr/pr-assigned";
import { startPRReview } from "./pr/pr-review-coordinator";
import {
  getVCSStatus,
  vcsStageFiles,
  vcsUnstageFiles,
  vcsStageAll,
  vcsUnstageAll,
  vcsRevertFiles,
  vcsCommit,
  vcsPush,
  vcsGetFileDiff,
  gitGetRecentCommits,
  gitGetScopedFiles,
  gitGetScopedFileDiff,
} from "./vcs/git-commit-provider";
import {
  jjLog,
  jjNew,
  jjFetch,
  jjPush,
  jjUndo,
  jjDescribe,
  jjAbandon,
  jjGetChangedFiles,
  jjGetFileDiff,
  jjGetBookmarks,
  jjEdit,
  jjBookmarkSet,
  jjRebase,
  jjGetRestorePreview,
  jjRestore,
  jjGetRangeChangedFiles,
  jjGetRangeFileDiff,
} from "./vcs/jj-commit-provider";

// --- Stream A: Terminal + Session ---
const ptyManager = new PtyManager();
// Keychain for Pi agent secrets (macOS only; other platforms throw on use).
const keychain = new MacKeychain();
// SessionManager starts with defaults, updated with real config after async load
const sessionManager = new SessionManager(defaultConfig(), keychain);

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
const hookListener = new HookEventListener(HookSettingsBuilder.socketPath);
const mcpServer = new McpHttpServer();
HookSettingsBuilder.cleanupStaleSettingsFiles().catch((err) =>
  console.error("[main] Settings cleanup failed:", err),
);
const activityTracker = new SessionActivityTracker();

// --- Stream G: History ---
const historyStore = new HistoryStore();
const piHistoryStore = new PiHistoryStore();
const historyAggregator = new HistoryAggregator();
historyAggregator.register(historyStore);
historyAggregator.register(piHistoryStore);
const aiContextProvider = new AIContextProvider(historyStore);

// --- Stream H: PR Feedback ---
const prMonitor = new PRMonitor();

// --- Terminal scrollback cache (webview sends periodic updates) ---
const scrollbackCache = new Map<string, { scrollback: string; cwd?: string }>();

// --- Remote terminal hub: fans out PTY output to Tempest Remote WS clients ---
const remoteHub = new RemoteTerminalHub();

// --- HTTP Remote Control Server ---
const httpServer = new TempestHttpServer({
  workspaceManager,
  activityTracker,
  getConfig: loadConfig,
  ptyManager,
  sessionStateManager,
  scrollbackCache,
  remoteHub,
});

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
      dot: true,
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

async function browsePath(
  query: string,
  workspacePath: string,
): Promise<{
  kind: "file" | "directory" | "not_found" | "error";
  resolvedPath: string;
  entries?: string[];
  error?: string;
}> {
  const home = homedir();

  let resolved: string;
  if (query.startsWith("~/") || query === "~") {
    resolved = query.replace(/^~/, home);
  } else if (query.startsWith("/")) {
    resolved = query;
  } else {
    resolved = resolve(workspacePath, query);
  }

  // Normalize trailing slashes (keep root "/" intact)
  if (resolved.length > 1 && resolved.endsWith("/")) {
    resolved = resolved.slice(0, -1);
  }

  try {
    const s = await stat(resolved);

    if (s.isFile()) {
      return { kind: "file", resolvedPath: resolved };
    }

    if (s.isDirectory()) {
      return { kind: "directory", resolvedPath: resolved, entries: await listDirEntries(resolved) };
    }

    return { kind: "not_found", resolvedPath: resolved };
  } catch (e: any) {
    if (e.code === "ENOENT") {
      // Path doesn't exist — try parent directory with partial filename prefix
      const lastSlash = resolved.lastIndexOf("/");
      if (lastSlash >= 0) {
        const parentDir = lastSlash === 0 ? "/" : resolved.slice(0, lastSlash);
        const partial = resolved.slice(lastSlash + 1).toLowerCase();
        try {
          const ps = await stat(parentDir);
          if (ps.isDirectory()) {
            const entries = await listDirEntries(parentDir, partial);
            return { kind: "directory", resolvedPath: parentDir, entries };
          }
        } catch {
          // parent doesn't exist either
        }
      }
      return { kind: "not_found", resolvedPath: resolved };
    }
    if (e.code === "EACCES") {
      return { kind: "error", resolvedPath: resolved, error: "Permission denied" };
    }
    return { kind: "error", resolvedPath: resolved, error: e.message ?? "Unknown error" };
  }
}

async function listDirEntries(dirPath: string, prefix?: string): Promise<string[]> {
  const dirents = await readdir(dirPath, { withFileTypes: true });
  const dirs: string[] = [];
  const files: string[] = [];

  for (const d of dirents) {
    if (prefix !== undefined && !d.name.toLowerCase().startsWith(prefix)) continue;
    const full = resolve(dirPath, d.name);
    if (d.isDirectory()) {
      if (!IGNORE_DIRS.has(d.name)) dirs.push(full + "/");
    } else if (d.isFile() || d.isSymbolicLink()) {
      files.push(full);
    }
  }

  dirs.sort();
  files.sort();
  return [...dirs, ...files];
}

/**
 * Walk a PaneNodeState tree and populate sessionID on claude tabs
 * by looking up PID → ~/.claude/sessions/{PID}.json.
 * Falls back to cwd-based matching if PID lookup fails.
 * Mutates the tree in place (it's a transient object about to be saved).
 */
function enrichTreeWithSessionIds(node: any, workspacePath: string): void {
  if (!node) return;
  if (node.type === "leaf" && node.pane?.tabs) {
    for (const tab of node.pane.tabs) {
      if (tab.kind !== "claude") continue;
      // Try PID-based lookup first
      if (tab.terminalId) {
        const pid = ptyManager.getPid(tab.terminalId);
        if (pid) {
          const sessionFile = join(homedir(), ".claude", "sessions", `${pid}.json`);
          try {
            const data = readFileSync(sessionFile, "utf-8");
            const session = JSON.parse(data);
            if (session.sessionId) {
              tab.sessionID = session.sessionId;
              continue;
            }
          } catch {
            // File not found or parse error — fall through to cwd-based lookup
          }
        }
      }
      // Fallback: cwd-based matching
      if (!tab.sessionID) {
        const matches = findSessionIDs(workspacePath);
        if (matches.length > 0) {
          tab.sessionID = matches[0];
        }
      }
    }
  } else if (node.type === "split" && node.children) {
    for (const child of node.children) {
      enrichTreeWithSessionIds(child, workspacePath);
    }
  }
}

/**
 * Walk a PaneNodeState tree and populate scrollbackContent and shellCwd
 * on terminal tabs using the scrollback cache (populated by the webview).
 * Mutates the tree in place (it's a transient object about to be saved).
 */
function enrichTreeWithScrollback(node: any): void {
  if (!node) return;
  if (node.type === "leaf" && node.pane?.tabs) {
    for (const tab of node.pane.tabs) {
      if (tab.kind !== "shell" && tab.kind !== "claude") continue;
      if (!tab.terminalId) continue;
      const cached = scrollbackCache.get(tab.terminalId);
      if (cached) {
        tab.scrollbackContent = cached.scrollback;
        if (cached.cwd) tab.shellCwd = cached.cwd;
      }
    }
  } else if (node.type === "split" && node.children) {
    for (const child of node.children) {
      enrichTreeWithScrollback(child);
    }
  }
}

// Persistent watcher on ~/.claude/sessions/ — resolves session IDs for all
// Claude terminals as soon as Claude writes the PID file.
let sessionsWatcher: FSWatcher | null = null;
let sessionsWatcherRetryTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;

function scheduleSessionsWatcherRetry(sessionsPath: string, reason: unknown): void {
  if (isShuttingDown) return;
  if (sessionsWatcherRetryTimer) return;
  console.warn(`[session] Retrying watcher start for ${sessionsPath} in 5s`, reason);
  sessionsWatcherRetryTimer = setTimeout(() => {
    sessionsWatcherRetryTimer = null;
    startSessionsWatcher();
  }, 5000);
}

function clearSessionsWatcherRetry(): void {
  if (!sessionsWatcherRetryTimer) return;
  clearTimeout(sessionsWatcherRetryTimer);
  sessionsWatcherRetryTimer = null;
}

function startSessionsWatcher(): void {
  if (isShuttingDown) return;
  const sessionsPath = join(homedir(), ".claude", "sessions");
  if (sessionsWatcher) return;

  try {
    // Ensure the directory exists so first-time users still get live session resolution.
    mkdirSync(sessionsPath, { recursive: true });
  } catch (err) {
    console.error(`[session] Failed to create ${sessionsPath}:`, err);
    scheduleSessionsWatcherRetry(sessionsPath, err);
    return;
  }

  try {
    sessionsWatcher = watch(sessionsPath, (_eventType, filename) => {
      if (!filename?.endsWith(".json")) return;
      const pid = parseInt(filename.replace(".json", ""), 10);
      if (isNaN(pid)) return;

      // Only care about PIDs that belong to one of our terminals
      const terminalId = ptyManager.findTerminalByPid(pid);
      if (!terminalId) return;

      try {
        const data = readFileSync(join(sessionsPath, filename), "utf-8");
        const session = JSON.parse(data);
        if (session.sessionId) {
          console.log(`[session] Resolved session ${session.sessionId} for terminal ${terminalId} (PID ${pid})`);
          try {
            win.webview.rpc.send.sessionIdResolved({ terminalId, sessionId: session.sessionId });
          } catch { /* webview not ready */ }
        }
      } catch {
        // File may be partially written — next event will retry
      }
    });

    sessionsWatcher.on("error", (err) => {
      console.error(`[session] Watcher error for ${sessionsPath}:`, err);
      try {
        sessionsWatcher?.close();
      } catch {
        // no-op
      }
      sessionsWatcher = null;
      scheduleSessionsWatcherRetry(sessionsPath, err);
    });

    clearSessionsWatcherRetry();
    console.log(`[session] Watching ${sessionsPath} for session files`);
  } catch (err) {
    sessionsWatcher = null;
    console.error(`[session] Failed to watch ${sessionsPath}:`, err);
    scheduleSessionsWatcherRetry(sessionsPath, err);
  }
}

// Define RPC — all streams' handlers combined
const rpc: any = (BrowserView.defineRPC as any)({
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
      // --- Session ID Lookup (PID → Claude session) ---
      lookupTerminalSessionId: async (params: any) => {
        const { terminalId, workspacePath } = params as {
          terminalId: string;
          workspacePath: string;
        };
        // Try PID-based lookup first
        const pid = ptyManager.getPid(terminalId);
        if (pid) {
          const sessionId = await lookupSessionID(pid);
          if (sessionId) return { sessionId };
        }
        // Fallback: scan all session files matching this workspace cwd
        const matches = findSessionIDs(workspacePath);
        if (matches.length > 0) return { sessionId: matches[0] };
        return { sessionId: null };
      },

      getSessionPlanPath: (params: any) => {
        const { sessionId, workspacePath } = params as {
          sessionId: string;
          workspacePath: string;
        };
        const planPath = lookupPlanPath(sessionId, workspacePath);
        return { planPath };
      },

      buildClaudeCommand: (params: any) => sessionManager.buildClaudeCommand({
        ...params,
        mcpPort: mcpServer.getPort(),
        mcpToken: mcpServer.getToken(),
      }),
      buildShellCommand: (params: any) => sessionManager.buildShellCommand(params),
      buildPiCommand: (params: any) => sessionManager.buildPiCommand(params),
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
      removeRepo: async (_params: any) => {
        await workspaceManager.removeRepo(_params.repoId);
      },
      cloneRepo: async (_params: any) => {
        return await workspaceManager.cloneRepo(_params);
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
      renameWorkspace: async (_params: any) => {
        const result = await workspaceManager.renameWorkspace(
          _params.workspaceId,
          _params.newName,
        );
        if (result.success && result.oldPath && result.newPath && result.repoId) {
          sessionStateManager.migrateWorkspacePath(result.oldPath, result.newPath);
          await sessionStateManager.flush();
          try {
            win.webview.rpc.send.workspaceRenamed({
              repoId: result.repoId,
              oldPath: result.oldPath,
              newPath: result.newPath,
              workspace: result.workspace!,
            });
          } catch { /* webview not ready yet */ }
        }
        return {
          success: result.success,
          error: result.error,
          workspace: result.workspace,
          oldPath: result.oldPath,
          newPath: result.newPath,
        };
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

      // --- Pi env vars (keychain-backed) ---
      listPiEnvVarNames: () => {
        return workspaceManager.getConfig().piEnvVarNames ?? [];
      },
      setPiEnvVar: async (_params: any) => {
        const { name, value } = _params as { name: string; value: string };
        if (!isValidEnvVarName(name)) {
          return { success: false, error: `Invalid env var name: ${name}` };
        }
        try {
          await keychain.setSecret(name, value);
          const config = workspaceManager.getConfig();
          const existing = config.piEnvVarNames ?? [];
          if (!existing.includes(name)) {
            await workspaceManager.saveConfig({
              ...config,
              piEnvVarNames: [...existing, name].sort(),
            });
          }
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
      },
      deletePiEnvVar: async (_params: any) => {
        const { name } = _params as { name: string };
        try {
          await keychain.deleteSecret(name);
          const config = workspaceManager.getConfig();
          const existing = config.piEnvVarNames ?? [];
          if (existing.includes(name)) {
            await workspaceManager.saveConfig({
              ...config,
              piEnvVarNames: existing.filter((n) => n !== name),
            });
          }
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) };
        }
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
      testArchiveScript: async (_params: any) => {
        return await workspaceManager.runPrepareScript(_params.script, _params.repoPath);
      },

      // --- Custom Scripts ---
      runCustomScript: async (_params: any) => {
        return await workspaceManager.runCustomScript(_params);
      },
      resolveScriptLaunch: async (_params: any) => {
        const resolved = await workspaceManager.resolveScriptLaunch(_params);
        if (!resolved) {
          throw new Error("No script or scriptPath provided");
        }
        return resolved;
      },
      getPackageScripts: async (_params: any) => {
        return await workspaceManager.getPackageScripts(_params.workspacePath);
      },
      browseFile: async (_params: any) => {
        const { startingFolder } = (_params ?? {}) as { startingFolder?: string };
        const home = Bun.env.HOME ?? "/";
        const resolved = (startingFolder || "~/").replace(/^~(?=\/|$)/, home);
        const paths = await Utils.openFileDialog({
          startingFolder: resolved,
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        return { path: paths.length > 0 ? paths[0] : null };
      },
      getRemoteRepos: async (_params: any) => {
        return await workspaceManager.getRemoteRepos(_params.repoPath);
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

      // --- Activity State ---
      getActivityState: () => {
        activityTracker.cleanStale();
        return activityTracker.allCWDStates();
      },

      // --- Session State (Stream D) ---
      loadSessionState: async () => {
        return await sessionStateManager.load();
      },
      savePaneState: (_params: any) => {
        enrichTreeWithSessionIds(_params.paneTree, _params.workspacePath);
        sessionStateManager.savePaneState(_params.workspacePath, _params.paneTree);
        sessionStateManager.setSelectedWorkspacePath(_params.workspacePath);
      },
      setRepoExpanded: async (_params: any) => {
        const { repoId, isExpanded } = _params as { repoId: string; isExpanded: boolean };
        workspaceManager.setRepoExpanded(repoId, isExpanded);
        sessionStateManager.setRepoCollapsed(repoId, !isExpanded);
        await sessionStateManager.flush();
      },
      saveFileTreeState: (_params: any) => {
        sessionStateManager.saveFileTreeState(_params);
      },

      // --- Files (Stream E) ---
      listFiles: async (params: any) => {
        return listFilesInDir((params as { workspacePath: string }).workspacePath);
      },
      browsePath: async (params: any) => {
        const { query, workspacePath } = params as { query: string; workspacePath: string };
        return browsePath(query, workspacePath);
      },

      // --- File tree (sidebar) ---
      listDir: async (params: any) => {
        const { dirPath, workspacePath } = params as {
          dirPath: string;
          workspacePath?: string;
        };
        return await listDir(dirPath, workspacePath);
      },
      watchDirectoryTree: (params: any) => {
        const { workspacePath } = params as { workspacePath: string };
        watchDirectoryTree(workspacePath, (wsPath, changedDirPath, kind) => {
          try {
            win.webview.rpc.send.directoryChanged({
              workspacePath: wsPath,
              changedDirPath,
              changeKind: kind,
            });
          } catch {
            // webview not ready — swallow
          }
        });
      },
      unwatchDirectoryTree: (params: any) => {
        const { workspacePath } = params as { workspacePath: string };
        unwatchDirectoryTree(workspacePath);
      },
      unwatchAllDirectoryTrees: () => {
        unwatchAllDirectoryTrees();
      },
      revealInFinder: (params: any) => {
        const { path } = params as { path: string };
        // macOS "open -R <path>" reveals the item in Finder (highlights it in
        // its parent directory). For directories, -R likewise selects the
        // folder in its parent. If the path doesn't exist, open emits an
        // error to stderr which we swallow.
        try {
          Bun.spawn(["open", "-R", path], { stderr: "ignore", stdout: "ignore" });
        } catch (err) {
          console.warn("[revealInFinder] failed:", err);
        }
      },

      // --- Onboarding (Stream F) ---
      checkBinaries: () => {
        const config = workspaceManager.getConfig();
        const resolver = new PathResolver();
        const canResolve = (name: string, configuredPath?: string) => {
          try {
            resolver.resolve(name, configuredPath);
            return true;
          } catch {
            return false;
          }
        };
        return {
          git: canResolve("git", config.gitPath),
          jj: canResolve("jj", config.jjPath),
          claude: canResolve("claude", config.claudePath),
          gh: canResolve("gh", config.ghPath),
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
        const provider = historyAggregator.provider(params.provider ?? "claude");
        return provider.getSessions(params.scope, params.workspacePath);
      },
      searchHistory: async (params: any) => {
        const provider = historyAggregator.provider(params.provider ?? "claude");
        return provider.searchSessions(
          params.query,
          params.scope,
          params.workspacePath,
        );
      },
      getSessionMessages: async (params: any) => {
        return historyAggregator.getMessages(params.sessionFilePath);
      },
      isHistorySearchAvailable: async (params: any) => {
        const provider = historyAggregator.provider(params?.provider ?? "claude");
        return provider.isSearchAvailable;
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

      // --- AI Context ---
      getAIContextForFile: async (params: any) => {
        return await aiContextProvider.contextForFile(params.filePath, params.projectPath);
      },
      getAITimelineForFile: async (params: any) => {
        return await aiContextProvider.timelineForFile(params.filePath, params.projectPath);
      },

      // --- PR URL Lookup ---
      getRepoGitHubUrl: async (params: any) => {
        return await workspaceManager.getRepoGitHubUrl(params.workspacePath);
      },

      lookupPRUrl: async (params: any) => {
        const vcsInfo = await workspaceManager.getWorkspaceVCSInfo(params.workspacePath);
        if (!vcsInfo) {
          return { error: "No branch or bookmark found for the current workspace." };
        }
        return await lookupPRUrl(vcsInfo.repoPath, vcsInfo.branch);
      },

      // --- Open PR (push + create draft PR) ---
      getDefaultPRTitleBody: async (params: any) => {
        try {
          const ws = workspaceManager.findWorkspaceByPath(params.workspacePath);
          if (!ws) return { error: "Workspace not found." };
          const vcsType = workspaceManager.getVCSType(ws.repoPath);
          return await getDefaultTitleAndBody(
            params.workspacePath, ws.repoPath, vcsType,
          );
        } catch (err: any) {
          return { error: err.message ?? String(err) };
        }
      },
      openPR: async (params: any) => {
        try {
          const ws = workspaceManager.findWorkspaceByPath(params.workspacePath);
          if (!ws) return { error: "Workspace not found." };
          const vcsType = workspaceManager.getVCSType(ws.repoPath);
          const prURL = await openPRAction(
            params.workspacePath, ws.repoPath, vcsType,
            params.bookmarkName, params.title, params.body, params.draft ?? true,
          );
          // Persist PR state
          sessionStateManager.savePRState(params.workspacePath, {
            bookmarkName: params.bookmarkName,
            prURL,
          });
          return { prURL };
        } catch (err: any) {
          return { error: err.message ?? String(err) };
        }
      },
      updatePR: async (params: any) => {
        try {
          const ws = workspaceManager.findWorkspaceByPath(params.workspacePath);
          if (!ws) return { success: false, error: "Workspace not found." };
          const vcsType = workspaceManager.getVCSType(ws.repoPath);
          const prState = sessionStateManager.getPRState(params.workspacePath);
          await updatePRAction(params.workspacePath, vcsType, prState?.bookmarkName);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message ?? String(err) };
        }
      },
      getOpenPRState: async (params: any) => {
        return sessionStateManager.getPRState(params.workspacePath);
      },
      setOpenPRState: async (params: any) => {
        sessionStateManager.savePRState(params.workspacePath, params.prState);
      },

      // --- Progress View ---
      getProgressData: async (params: any) => {
        const forceRefresh = params?.forceRefresh ?? false;
        if (forceRefresh) clearPRDetailCache();

        const repos = workspaceManager.getRepos();
        const results: any[] = [];
        const allActivityStates = activityTracker.allCWDStates();
        const backgroundRefreshes: Promise<void>[] = [];

        for (const repo of repos) {
          const workspaces = workspaceManager.getWorkspaces(repo.id);
          for (const ws of workspaces) {
            const sidebarInfo = await workspaceManager.getSidebarInfo(ws.path);
            const prState = sessionStateManager.getPRState(ws.path);
            const monitorConfig = prMonitor.getMonitorConfig(ws.path);
            const activity = allActivityStates[ws.path];
            const hasDiffChanges =
              (sidebarInfo.diffStats?.additions ?? 0) +
                (sidebarInfo.diffStats?.deletions ?? 0) >
              0;

            // Determine stage
            let stage: string;
            let prDetail = undefined;
            let prURL = prState?.prURL;
            const branch = sidebarInfo.bookmarkName;

            if (forceRefresh && branch) {
              // Force refresh: fetch fresh PR data synchronously for all workspaces with branches
              const detail = await getPRDetail(ws.repoPath, branch);
              if (detail) {
                prDetail = detail;
                prURL = prURL ?? detail.prURL;
                stage = detail.state === "merged" ? "merged" : "pullRequest";
              } else if (prState?.prURL) {
                stage = "pullRequest";
              } else if (hasDiffChanges || activity !== undefined) {
                stage = "inDevelopment";
              } else {
                stage = "new";
              }
            } else {
              // Normal path: use cached PR data for instant response
              const cachedPR = branch ? getPRDetailCached(ws.repoPath, branch) : null;

              if (prState?.prURL || cachedPR) {
                if (cachedPR) {
                  prDetail = cachedPR;
                  prURL = prURL ?? cachedPR.prURL;
                  stage = cachedPR.state === "merged" ? "merged" : "pullRequest";
                } else if (branch) {
                  stage = "pullRequest";
                  backgroundRefreshes.push(
                    getPRDetail(ws.repoPath, branch).then(() => {}),
                  );
                } else {
                  stage = "pullRequest";
                }
              } else if (hasDiffChanges || activity !== undefined) {
                stage = "inDevelopment";
                if (branch) {
                  backgroundRefreshes.push(
                    getPRDetail(ws.repoPath, branch).then(() => {}),
                  );
                }
              } else {
                stage = "new";
              }
            }

            // Workspace metadata (created date from filesystem, last opened from cache)
            const meta = getWorkspaceMeta(ws.path);
            const createdAt = await resolveWorkspaceCreatedAt(ws.path);

            // Plan file lookup — derives sessionId from the persisted pane
            // tree (in-memory) and uses a permanent sessionId→slug cache so
            // the hot path is one map lookup + one existsSync per workspace.
            let planPath: string | undefined;
            const claudeSessionId = sessionStateManager.getFirstClaudeSessionId(ws.path);
            if (claudeSessionId) {
              planPath = resolveSessionPlanPath(claudeSessionId, ws.path) ?? undefined;
            }

            results.push({
              workspaceId: ws.id,
              workspacePath: ws.path,
              workspaceName: ws.name,
              repoName: repo.name,
              repoPath: ws.repoPath,
              stage,
              branchName: sidebarInfo.bookmarkName,
              diffStats: sidebarInfo.diffStats,
              activityState: activity,
              prDetail,
              isMonitored: !!monitorConfig,
              prURL,
              createdAt,
              lastOpenedAt: meta.lastOpenedAt,
              planPath,
            });
          }
        }

        // Let background fetches run without blocking the response
        if (backgroundRefreshes.length > 0) {
          Promise.all(backgroundRefreshes).catch(() => {});
        }

        return results;
      },
      getPRDetail: async (params: any) => {
        return await getPRDetail(params.repoPath, params.branch);
      },
      notifyWorkspaceOpened: (params: any) => {
        setWorkspaceLastOpened(params.workspacePath);
      },

      // --- PR Review (create workspace for PR) ---
      startPRReview: async (params: any) => {
        return await startPRReview(workspaceManager, params.repoId, params.prNumber);
      },

      // --- Assigned PRs ---
      getAssignedPRs: async () => {
        return await getAssignedPRs();
      },
      refreshAssignedPRs: async () => {
        return await refreshAssignedPRs();
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

      // --- VCS Commit View ---
      getVCSStatus: async (params: any) => {
        // For JJ, "changed" means files in the current @ change (what
        // `jj status` reports). JJ tracks every edit as part of the working-
        // copy change, so Git-style uncommitted-vs-committed doesn't apply.
        const ws = workspaceManager.findWorkspaceByPath(params.workspacePath);
        if (ws && workspaceManager.getVCSType(ws.repoPath) === VCSType.JJ) {
          const changedFiles = await jjGetChangedFiles(params.workspacePath, "@");
          return {
            branch: "",
            ahead: 0,
            behind: 0,
            files: changedFiles.map((f) => ({
              path: f.path,
              changeType: f.changeType,
              staged: false,
            })),
          };
        }
        return await getVCSStatus(params.workspacePath);
      },
      vcsStageFiles: async (params: any) => {
        await vcsStageFiles(params.workspacePath, params.paths);
      },
      vcsUnstageFiles: async (params: any) => {
        await vcsUnstageFiles(params.workspacePath, params.paths);
      },
      vcsStageAll: async (params: any) => {
        await vcsStageAll(params.workspacePath);
      },
      vcsUnstageAll: async (params: any) => {
        await vcsUnstageAll(params.workspacePath);
      },
      vcsRevertFiles: async (params: any) => {
        return await vcsRevertFiles(params.workspacePath, params.paths);
      },
      vcsCommit: async (params: any) => {
        return await vcsCommit(params.workspacePath, params.message, params.amend);
      },
      vcsPush: async (params: any) => {
        return await vcsPush(params.workspacePath);
      },
      vcsGetFileDiff: async (params: any) => {
        return await vcsGetFileDiff(params.workspacePath, params.filePath, params.staged);
      },

      // --- Git Commit/Scope Selection ---
      gitGetRecentCommits: async (params: any) => {
        return await gitGetRecentCommits(params.workspacePath, params.count);
      },
      gitGetScopedFiles: async (params: any) => {
        return await gitGetScopedFiles(params.workspacePath, params.scope, params.commitRef);
      },
      gitGetScopedFileDiff: async (params: any) => {
        return await gitGetScopedFileDiff(params.workspacePath, params.scope, params.filePath, params.commitRef);
      },

      // --- JJ (Jujutsu) VCS View ---
      jjLog: async (params: any) => {
        return await jjLog(params.workspacePath, params.revset);
      },
      jjNew: async (params: any) => {
        return await jjNew(params.workspacePath, params.revisions);
      },
      jjFetch: async (params: any) => {
        return await jjFetch(params.workspacePath, params.remote, params.allRemotes);
      },
      jjPush: async (params: any) => {
        return await jjPush(params.workspacePath, params.bookmark, params.allTracked);
      },
      jjUndo: async (params: any) => {
        return await jjUndo(params.workspacePath);
      },
      jjDescribe: async (params: any) => {
        return await jjDescribe(params.workspacePath, params.revision, params.description);
      },
      jjAbandon: async (params: any) => {
        return await jjAbandon(params.workspacePath, params.revision);
      },
      jjGetChangedFiles: async (params: any) => {
        return await jjGetChangedFiles(params.workspacePath, params.revision);
      },
      jjGetFileDiff: async (params: any) => {
        return await jjGetFileDiff(params.workspacePath, params.revision, params.filePath);
      },
      jjGetBookmarks: async (params: any) => {
        return await jjGetBookmarks(params.workspacePath);
      },
      jjEdit: async (params: any) => {
        return await jjEdit(params.workspacePath, params.revision);
      },
      jjBookmarkSet: async (params: any) => {
        return await jjBookmarkSet(params.workspacePath, params.revision, params.name, params.track);
      },
      jjRebase: async (params: any) => {
        return await jjRebase(params.workspacePath, params.revision, params.destination);
      },
      jjGetRestorePreview: async (params: any) => {
        return await jjGetRestorePreview(
          params.workspacePath, params.targetRevision,
          params.sourceRevision, params.filePath,
        );
      },
      jjRestore: async (params: any) => {
        return await jjRestore(
          params.workspacePath, params.targetRevision,
          params.sourceRevision, params.filePath,
        );
      },
      jjGetRangeChangedFiles: async (params: any) => {
        return await jjGetRangeChangedFiles(params.workspacePath, params.fromRevision, params.toRevision);
      },
      jjGetRangeFileDiff: async (params: any) => {
        return await jjGetRangeFileDiff(params.workspacePath, params.fromRevision, params.toRevision, params.filePath);
      },

      // --- Open In (external editors) ---
      getInstalledEditors: () => getInstalledEditors(),
      openInEditor: (params: any) => openInEditor(params.editorId, params.directory),

      // --- Browser DNS ---
      resolveDns: async (params: any) => {
        try {
          await (Bun.dns as any).resolve(params.hostname);
          return { ok: true };
        } catch (err: any) {
          return { ok: false, error: err?.code ?? err?.message ?? "DNS lookup failed" };
        }
      },

      // --- HTTP Remote Control Server ---
      startHttpServer: (params: any) => {
        const config = {
          enabled: true,
          port: params.port ?? 7778,
          hostname: params.hostname ?? "127.0.0.1",
          token: params.token || generateToken(),
        };
        return httpServer.start(config);
      },
      stopHttpServer: () => {
        httpServer.stop();
      },
      getHttpServerStatus: () => {
        if (httpServer.isRunning()) {
          return {
            running: true,
            port: httpServer.getPort(),
            hostname: httpServer.getHostname(),
            token: httpServer.getToken(),
          };
        }
        const lastError = httpServer.getLastError();
        return { running: false, ...(lastError ? { error: lastError } : {}) };
      },
      consumePendingPrompt: (params: any) => {
        const data = consumePendingData(params.workspacePath);
        return { prompt: data?.prompt ?? null, planMode: data?.planMode ?? null };
      },
      getNetworkInterfaces: () => {
        const ifaces = networkInterfaces();
        const results: Array<{ name: string; address: string; family: string }> = [];
        for (const [name, entries] of Object.entries(ifaces)) {
          if (!entries) continue;
          for (const entry of entries) {
            if (entry.family === "IPv4" && !entry.internal) {
              results.push({ name, address: entry.address, family: "IPv4" });
            }
          }
        }
        return results;
      },
    },
    messages: {
      // --- Terminal I/O (Stream A) ---
      writeToTerminal: (msg: any) => {
        ptyManager.write(msg.id, msg.data);
      },
      clipboardWrite: (msg: any) => {
        const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
        proc.stdin.write(msg.text);
        proc.stdin.end();
      },
      showNotification: (msg: any) => {
        Utils.showNotification({ title: msg.title, body: msg.body });
      },

      // --- Pane state sync (Stream B + D) ---
      paneTreeChanged: (_msg: any) => {
        enrichTreeWithSessionIds(_msg.tree, _msg.workspacePath);
        enrichTreeWithScrollback(_msg.tree);
        sessionStateManager.savePaneState(_msg.workspacePath, _msg.tree);
        sessionStateManager.setSelectedWorkspacePath(_msg.workspacePath);

        // Some updates (e.g. Pi session path discovery) should be persisted
        // immediately to reduce loss risk on abrupt shutdown.
        if (_msg.flushNow) {
          void sessionStateManager.flush();
        }
      },

      // --- Terminal scrollback persistence ---
      terminalScrollbackUpdate: (msg: any) => {
        const { entries } = msg as {
          entries: Array<{ terminalId: string; scrollback: string; cwd?: string }>;
        };
        for (const entry of entries) {
          scrollbackCache.set(entry.terminalId, {
            scrollback: entry.scrollback,
            cwd: entry.cwd,
          });
        }
        // Enrich stored state so next flush includes latest scrollback
        sessionStateManager.enrichTerminalData(scrollbackCache);
      },

      // --- Window controls ---
      windowClose: () => { win.close(); },
      windowMinimize: () => { win.minimize(); },
      windowMaximize: () => {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      },

      // --- Stats (optional) ---
      saveLatencyStats: (_msg: any) => {},
    },
  },
});

// Create the main window
const win: any = new BrowserWindow({
  title: "Tempest",
  url: "views://main/index.html",
  frame: { width: 1400, height: 900, x: 100, y: 100 },
  titleBarStyle: "hiddenInset",
  rpc,
});

// Vertically center the macOS traffic-light buttons inside our 40px (h-10) top bar.
// (x, y) is the top-left of the close button, measured from the window's top-left.
win.setWindowButtonPosition(16, 17);

// --- Stream A: Wire PTY output/exit to webview ---
// Before the webview attaches, RPC sends throw synchronously — swallow those
// silently. Once we've seen one successful send we flip `webviewSendReady` and
// any later failure is a real bug (serialization, transport, post-shutdown),
// so we log it instead of hiding it.
let webviewSendReady = false;

ptyManager.onOutput((id, data, seq) => {
  try {
    win.webview.rpc.send.terminalOutput({ id, data, seq });
    webviewSendReady = true;
  } catch (err) {
    if (webviewSendReady) {
      console.warn("[main] terminalOutput send failed:", err);
    }
  }
});

ptyManager.onExit((id, exitCode) => {
  try {
    win.webview.rpc.send.terminalExit({ id, exitCode });
    webviewSendReady = true;
  } catch (err) {
    if (webviewSendReady) {
      console.warn("[main] terminalExit send failed:", err);
    }
  }
});

// --- Stream A (remote): Fan-out PTY output/exit to Tempest Remote WS clients ---
ptyManager.onOutput((id, data, seq) => {
  remoteHub.broadcast(id, data, seq);
});

ptyManager.onExit((id, exitCode) => {
  remoteHub.notifyExit(id, exitCode);
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

// --- Stream I: Wire custom script output push notifications ---
workspaceManager.onScriptOutput = (runId, data) => {
  try {
    win.webview.rpc.send.scriptOutput({ runId, data });
  } catch { /* webview not ready yet */ }
};
workspaceManager.onScriptExit = (runId, exitCode) => {
  try {
    win.webview.rpc.send.scriptExit({ runId, exitCode });
  } catch { /* webview not ready yet */ }
};

// --- HTTP Server: Wire push notifications ---
httpServer.onSelectWorkspace = (workspacePath) => {
  try {
    win.webview.rpc.send.selectWorkspace({ workspacePath });
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
      { label: "Progress", action: "view-progress", accelerator: "Cmd+5" },
      { label: "Terminal", action: "view-terminal", accelerator: "Cmd+1" },
      { label: "VCS", action: "view-vcs", accelerator: "Cmd+2" },
      { label: "Dashboard", action: "view-dashboard", accelerator: "Cmd+3" },
      { type: "separator" },
      { label: "Toggle Developer Tools", action: "toggle-devtools", accelerator: "Cmd+Alt+I" },
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
  // Migrate data from legacy directories (~/.tempest, ~/Library/Application Support/Tempest)
  // into ~/.config/tempest. Safe to remove after a few versions.
  runMigration();

  // Load config and update SessionManager
  try {
    const config = await loadConfig();
    sessionManager.updateConfig(config);
    console.log("[main] Config loaded:", config.workspaceRoot, "claudeArgs:", config.claudeArgs);
  } catch (err) {
    console.error("[main] Config load failed, using defaults:", err);
  }

  try {
    await sessionStateManager.load();
  } catch (err) {
    console.error("[main] SessionStateManager preload failed:", err);
  }

  try {
    workspaceManager.setCollapsedResolver((repoId) =>
      sessionStateManager.isRepoCollapsed(repoId),
    );
    await workspaceManager.initialize();
    console.log("[main] WorkspaceManager initialized");
  } catch (err) {
    console.error("[main] WorkspaceManager init failed:", err);
  }

  try {
    hookListener.start((event) => {
      // Pi session discovery: the Tempest-owned Pi extension fires this
      // event on session_start with transcriptPath = the .jsonl session
      // file. We resolve the terminalId from Pi's PID and route the path
      // through the same sessionIdResolved RPC Claude's watcher uses.
      if (event.eventType === "pi_session_start") {
        const terminalId = ptyManager.findTerminalByPid(event.pid);
        const sessionPath = event.transcriptPath;
        if (terminalId && sessionPath) {
          try {
            win.webview.rpc.send.sessionIdResolved({
              terminalId,
              sessionId: sessionPath,
            });
          } catch { /* webview not ready yet */ }
        }
        return;
      }

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

  // Start MCP HTTP server for the show_webpage tool
  try {
    mcpServer.onShowWebpage = (workspaceKey, title, filePath) => {
      const all = workspaceManager.getAllWorkspaces();
      const ws = all.find(
        (w) =>
          w.id === workspaceKey
          || w.name === workspaceKey
          || w.path.endsWith(`/${workspaceKey}`),
      );
      const workspacePath = ws?.path ?? workspaceKey;
      try {
        win.webview.rpc.send.showWebpage({ title, filePath, workspacePath });
      } catch { /* webview not ready */ }
    };
    mcpServer.start();
  } catch (err) {
    console.error("[main] McpHttpServer start failed:", err);
  }

  activityTracker.startCleanupTimer();
  startSessionsWatcher();
  sessionStateManager.startAutoSave();

  try {
    await historyAggregator.initializeAll();
    historyAggregator.startRefreshTimers();
    console.log("[main] History providers initialized");
  } catch (err) {
    console.error("[main] History providers init failed:", err);
  }

  // Auto-start HTTP server if configured
  try {
    const config = await loadConfig();
    if (config.httpServer?.enabled) {
      httpServer.start(config.httpServer);
    }
  } catch (err) {
    console.error("[main] HTTP server auto-start failed:", err);
  }
})();

// --- Shutdown cleanup (Stream A + D) ---
let shutdownPromise: Promise<void> | null = null;

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    console.log("[main] Shutting down...");
    isShuttingDown = true;
    clearSessionsWatcherRetry();
    sessionsWatcher?.close();
    sessionsWatcher = null;

    // Collect final scrollback from webview before killing PTYs
    try {
      const result = await (win.webview.rpc as any).request.getTerminalScrollback();
      if (result?.entries) {
        for (const entry of result.entries) {
          scrollbackCache.set(entry.terminalId, {
            scrollback: entry.scrollback,
            cwd: entry.cwd,
          });
        }
        sessionStateManager.enrichTerminalData(scrollbackCache);
      }
    } catch (e) {
      console.warn("[main] Failed to collect scrollback at shutdown:", e);
    }

    ptyManager.killAll();
    await sessionStateManager.flush();
    sessionStateManager.stopAutoSave();
    hookListener.stop();
    activityTracker.stopCleanupTimer();
    workspaceManager.stopSidebarRefresh();
    historyAggregator.stopRefreshTimers();
    unwatchAllMarkdown();
    unwatchAllDirectoryTrees();
    prMonitor.shutdown();
    httpServer.stop();
    mcpServer.stop();
  })();

  return shutdownPromise;
}

process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
process.on("beforeExit", async () => { await shutdown(); });

console.log("[main] Tempest started");
