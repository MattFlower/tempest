// ============================================================
// File tree service: directory listing + recursive fs.watch.
// Produces structured DirEntry[] for the sidebar tree view, and
// watches each expanded workspace root with a single recursive
// watcher (macOS-only behavior). Emits coalesced per-directory
// change events back to the webview.
// ============================================================

import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve, basename, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { DirEntry } from "../../shared/ipc-types";

// Directory names treated as "ignored by default" — they're rendered dimmed
// in the tree rather than hidden, matching the behavior for .gitignore matches.
// These are the usual suspects that users almost never want to browse into.
const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".jj",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "target",
  ".idea",
  ".vscode",
]);

// Per-workspace gitignore cache. We rebuild when the workspace's .gitignore
// files change — the existing fs.watch registry will fire directoryChanged
// events which invalidate the cache via clearIgnoreCache().
interface IgnoreCache {
  workspacePath: string;
  // Keyed by absolute directory path — each cached matcher reflects the
  // combined rules from all .gitignore files between workspacePath and that
  // directory (inclusive).
  matchers: Map<string, Ignore>;
}

const ignoreCaches = new Map<string, IgnoreCache>();

function clearIgnoreCacheForWorkspace(workspacePath: string): void {
  ignoreCaches.delete(workspacePath);
}

/** Try to read and append a directory's .gitignore / .jj-ignore rules to the
 *  matcher. Silently skips missing or unreadable files. */
async function appendIgnoreFile(
  matcher: Ignore,
  dirPath: string,
): Promise<void> {
  for (const name of [".gitignore", ".jj-ignore"]) {
    try {
      const content = await Bun.file(resolve(dirPath, name)).text();
      matcher.add(content);
    } catch {
      // missing or unreadable — skip
    }
  }
}

/** Build (or reuse from cache) an ignore matcher for a specific directory
 *  within a workspace, combining all .gitignore rules along the path from
 *  workspacePath to dirPath. */
async function getIgnoreMatcher(
  workspacePath: string,
  dirPath: string,
): Promise<Ignore> {
  let cache = ignoreCaches.get(workspacePath);
  if (!cache) {
    cache = { workspacePath, matchers: new Map() };
    ignoreCaches.set(workspacePath, cache);
  }
  const cached = cache.matchers.get(dirPath);
  if (cached) return cached;

  const matcher = ignore();

  // Walk from workspace root down to dirPath, adding each .gitignore we find.
  // This correctly handles nested .gitignore files.
  const rel = relative(workspacePath, dirPath);
  const segments = rel === "" ? [] : rel.split(sep);

  let current = workspacePath;
  await appendIgnoreFile(matcher, current);
  for (const seg of segments) {
    current = resolve(current, seg);
    await appendIgnoreFile(matcher, current);
  }

  cache.matchers.set(dirPath, matcher);
  return matcher;
}

/** Test whether an absolute path is ignored within a workspace. Handles the
 *  directory-vs-file distinction since `ignore` library's matcher needs a
 *  trailing slash for dirs to match directory-only patterns like `dist/`. */
function isPathIgnored(
  matcher: Ignore,
  workspacePath: string,
  absolutePath: string,
  isDirectory: boolean,
): boolean {
  const rel = relative(workspacePath, absolutePath);
  if (rel === "" || rel.startsWith("..")) return false;
  const testPath = isDirectory ? rel + "/" : rel;
  return matcher.ignores(testPath);
}

export interface ListDirResult {
  ok: boolean;
  entries?: DirEntry[];
  error?: string;
  errorKind?: "not_found" | "permission" | "not_a_directory" | "other";
}

/** List the immediate children of a directory as structured DirEntry objects.
 *  Directories are returned first (alphabetical), then files (alphabetical).
 *  When `workspacePath` is provided, entries are marked with `isIgnored=true`
 *  if they match any .gitignore / .jj-ignore rule in the workspace, or if
 *  they're one of the always-ignored directory names (node_modules, etc.).
 *  Ignored entries are NOT filtered out — they're returned for the UI to
 *  render dimmed. */
export async function listDir(
  dirPath: string,
  workspacePath?: string,
): Promise<ListDirResult> {
  try {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    const dirs: DirEntry[] = [];
    const files: DirEntry[] = [];

    const matcher = workspacePath
      ? await getIgnoreMatcher(workspacePath, dirPath)
      : null;

    for (const d of dirents) {
      const fullPath = resolve(dirPath, d.name);
      const isSymlink = d.isSymbolicLink();
      // Mirror listDirEntries at src/bun/index.ts:230 — treat symlinks as files
      // (avoids cycles without needing a followed-paths set).
      const isDirectory = !isSymlink && d.isDirectory();

      const hardcodedIgnore = isDirectory && DEFAULT_IGNORED_DIRS.has(d.name);
      const ignoreMatch = matcher
        ? isPathIgnored(matcher, workspacePath!, fullPath, isDirectory)
        : false;
      const isIgnored = hardcodedIgnore || ignoreMatch;

      const entry: DirEntry = {
        name: d.name,
        fullPath,
        isDirectory,
        isSymlink,
        ...(isIgnored ? { isIgnored: true } : {}),
      };

      if (isDirectory) dirs.push(entry);
      else files.push(entry);
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, entries: [...dirs, ...files] };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { ok: false, error: "Not found", errorKind: "not_found" };
    }
    if (err?.code === "EACCES" || err?.code === "EPERM") {
      return { ok: false, error: "Permission denied", errorKind: "permission" };
    }
    if (err?.code === "ENOTDIR") {
      return { ok: false, error: "Not a directory", errorKind: "not_a_directory" };
    }
    return {
      ok: false,
      error: err?.message ?? String(err),
      errorKind: "other",
    };
  }
}

// --- Recursive watcher registry ---

type DirectoryChangedCallback = (
  workspacePath: string,
  changedDirPath: string,
  kind: "create" | "delete" | "rename" | "unknown",
) => void;

interface WorkspaceWatcher {
  watcher: FSWatcher;
  pendingDirs: Map<string, NodeJS.Timeout>; // changedDirPath → debounce timer
}

const watchers = new Map<string, WorkspaceWatcher>();
const DEBOUNCE_MS = 100;

export interface WatchDirectoryTreeResult {
  ok: boolean;
  errorKind?: "not_found" | "other";
}

/** Start (or no-op if already running) a recursive fs.watch for a workspace.
 *  On macOS recursive mode works natively; on other platforms the events are
 *  shallow and subtree changes will be missed. Tempest is macOS-only today.
 *
 *  Returns `{ ok: false, errorKind: "not_found" }` when the workspace path no
 *  longer exists on disk so the caller can prune it from its expanded set. */
export function watchDirectoryTree(
  workspacePath: string,
  onChanged: DirectoryChangedCallback,
): WatchDirectoryTreeResult {
  if (watchers.has(workspacePath)) return { ok: true };

  try {
    const watcher = watch(
      workspacePath,
      { recursive: true },
      (eventType, changedRelPath) => {
        if (changedRelPath === null) return;

        // If the changed file is a .gitignore / .jj-ignore, invalidate the
        // ignore-matcher cache so subsequent listDir calls re-read the rules.
        const relStr = String(changedRelPath);
        const changedBase = basename(relStr);
        if (changedBase === ".gitignore" || changedBase === ".jj-ignore") {
          clearIgnoreCacheForWorkspace(workspacePath);
        }

        // Skip events for paths inside always-ignored directories
        // (node_modules, .git, etc.) — we don't need to refresh those in the
        // tree since they're not meaningfully browsable. Relative paths use
        // forward slashes on macOS.
        const parts = relStr.split("/");
        if (parts.some((p) => DEFAULT_IGNORED_DIRS.has(p))) return;

        const absolutePath = resolve(workspacePath, String(changedRelPath));
        const changedDirPath = dirname(absolutePath);

        // Detect rename vs create/delete from the event type. fs.watch on macOS
        // only ever emits "rename" (structural change) and "change" (file
        // content change); that's enough to decide whether the directory needs
        // a refetch.
        const kind: "create" | "delete" | "rename" | "unknown" =
          eventType === "rename" ? "rename" : "unknown";

        const state = watchers.get(workspacePath);
        if (!state) return;

        const existing = state.pendingDirs.get(changedDirPath);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          state.pendingDirs.delete(changedDirPath);
          try {
            onChanged(workspacePath, changedDirPath, kind);
          } catch (err) {
            console.error(
              `[file-tree-watcher] onChanged threw for ${changedDirPath}:`,
              err,
            );
          }
        }, DEBOUNCE_MS);
        state.pendingDirs.set(changedDirPath, timer);
      },
    );

    watcher.on("error", (err) => {
      console.error(
        `[file-tree-watcher] Watcher error for ${workspacePath}:`,
        err,
      );
      unwatchDirectoryTree(workspacePath);
    });

    watchers.set(workspacePath, { watcher, pendingDirs: new Map() });
    return { ok: true };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // The workspace directory no longer exists — likely a forgotten jj
      // workspace still present in the persisted expanded-set. The caller
      // is expected to prune; nothing to log loudly.
      return { ok: false, errorKind: "not_found" };
    }
    console.error(
      `[file-tree-watcher] Failed to watch ${workspacePath}:`,
      err,
    );
    return { ok: false, errorKind: "other" };
  }
}

/** Stop watching a workspace. Flushes any pending debounce timers and clears
 *  the ignore-matcher cache for that workspace. */
export function unwatchDirectoryTree(workspacePath: string): void {
  const state = watchers.get(workspacePath);
  if (!state) return;
  for (const timer of state.pendingDirs.values()) clearTimeout(timer);
  state.pendingDirs.clear();
  try {
    state.watcher.close();
  } catch {
    // noop
  }
  watchers.delete(workspacePath);
  clearIgnoreCacheForWorkspace(workspacePath);
}

/** Stop every active watcher. Called on webview disconnect / shutdown. */
export function unwatchAllDirectoryTrees(): void {
  for (const path of Array.from(watchers.keys())) {
    unwatchDirectoryTree(path);
  }
}

// Exposed for tests / diagnostics.
export function _getWatchedWorkspacePaths(): string[] {
  return Array.from(watchers.keys());
}

// Re-export basename so callers don't need to import node:path themselves.
export { basename };
