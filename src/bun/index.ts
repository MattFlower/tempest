// ============================================================
// Bun process entry point.
// Creates the main window, wires RPC handlers, sets up menus.
// All 5 streams integrated.
// ============================================================

import { readFileSync, watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { BrowserWindow, BrowserView, ApplicationMenu, Utils } from "electrobun/bun";
import { PtyManager } from "./pty-manager";
import { SessionManager } from "./session-manager";
import { BookmarkManager } from "./browser/bookmark-manager";
import { WorkspaceManager } from "./workspace-manager";
import { SessionStateManager } from "./session-state-manager";
import { HookEventListener } from "./hooks/hook-event-listener";
import { HookSettingsBuilder } from "./hooks/hook-settings-builder";
import { SessionActivityTracker } from "./hooks/session-activity-tracker";
import { McpHttpServer } from "./mcp/mcp-http-server";

import { lookupSessionID, findSessionIDs, lookupPlanPath } from "./session-id-lookup";
import { loadConfig, saveConfig as saveConfigFile, defaultConfig } from "./config/app-config";
import { PathResolver } from "./config/path-resolver";
import { TempestHttpServer, generateToken, consumePendingData } from "./http-server";
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
import { getDefaultTitleAndBody, openPR as openPRAction, updatePR as updatePRAction } from "./pr/pr-open";
import { getAssignedPRs } from "./pr/pr-assigned";
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
} from "./vcs/jj-commit-provider";

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
const hookListener = new HookEventListener(HookSettingsBuilder.socketPath);
const mcpServer = new McpHttpServer();
HookSettingsBuilder.cleanupStaleSettingsFiles().catch((err) =>
  console.error("[main] Settings cleanup failed:", err),
);
const activityTracker = new SessionActivityTracker();

// --- Stream G: History ---
const historyStore = new HistoryStore();
const aiContextProvider = new AIContextProvider(historyStore);

// --- Stream H: PR Feedback ---
const prMonitor = new PRMonitor();

// --- HTTP Remote Control Server ---
const httpServer = new TempestHttpServer({
  workspaceManager,
  activityTracker,
  getConfig: loadConfig,
});

// --- Terminal scrollback cache (webview sends periodic updates) ---
const scrollbackCache = new Map<string, { scrollback: string; cwd?: string }>();

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

function startSessionsWatcher(): void {
  const sessionsPath = join(homedir(), ".claude", "sessions");

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
    console.log(`[session] Watching ${sessionsPath} for session files`);
  } catch (err) {
    console.error(`[session] Failed to watch ${sessionsPath}:`, err);
  }
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
      testArchiveScript: async (_params: any) => {
        return await workspaceManager.runPrepareScript(_params.script, _params.repoPath);
      },

      // --- Custom Scripts ---
      runCustomScript: async (_params: any) => {
        return await workspaceManager.runCustomScript(_params);
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

      // --- Files (Stream E) ---
      listFiles: async (params: any) => {
        return listFilesInDir((params as { workspacePath: string }).workspacePath);
      },
      browsePath: async (params: any) => {
        const { query, workspacePath } = params as { query: string; workspacePath: string };
        return browsePath(query, workspacePath);
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
            params.workspacePath, ws.repoPath, vcsType, params.bookmarkName,
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
            params.bookmarkName, params.title, params.body,
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

      // --- PR Review (create workspace for PR) ---
      startPRReview: async (params: any) => {
        return await startPRReview(workspaceManager, params.repoId, params.prNumber);
      },

      // --- Assigned PRs ---
      getAssignedPRs: async () => {
        return await getAssignedPRs();
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
      { label: "Terminal", action: "view-terminal", accelerator: "Cmd+1" },
      { label: "Diff", action: "view-diff", accelerator: "Cmd+2" },
      { label: "Dashboard", action: "view-dashboard", accelerator: "Cmd+3" },
      { label: "VCS", action: "view-vcs", accelerator: "Cmd+4" },
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

  // Start MCP HTTP server for the show_webpage tool
  try {
    mcpServer.onShowWebpage = (workspaceName, title, filePath) => {
      const all = workspaceManager.getAllWorkspaces();
      const ws = all.find((w) => w.name === workspaceName || w.path.endsWith(`/${workspaceName}`));
      const workspacePath = ws?.path ?? workspaceName;
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
    await historyStore.initialize();
    historyStore.startRefreshTimer();
    console.log("[main] HistoryStore initialized");
  } catch (err) {
    console.error("[main] HistoryStore init failed:", err);
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
async function shutdown() {
  console.log("[main] Shutting down...");
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
  historyStore.stopRefreshTimer();
  unwatchAllMarkdown();
  prMonitor.shutdown();
  httpServer.stop();
  mcpServer.stop();
}

process.on("SIGINT", () => { shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { shutdown().then(() => process.exit(0)); });
process.on("beforeExit", async () => { await shutdown(); });

console.log("[main] Tempest started");
