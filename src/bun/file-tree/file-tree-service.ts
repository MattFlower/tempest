// ============================================================
// File tree service: directory listing + recursive fs.watch.
// Produces structured DirEntry[] for the sidebar tree view, and
// watches each expanded workspace root with a single recursive
// watcher (macOS-only behavior). Emits coalesced per-directory
// change events back to the webview.
// ============================================================

import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import type { DirEntry } from "../../shared/ipc-types";

// Directory names that should never appear in the tree, anywhere.
// Mirrors the hardcoded list used by listFiles in src/bun/index.ts.
const IGNORE_DIRS = new Set([
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

export interface ListDirResult {
  ok: boolean;
  entries?: DirEntry[];
  error?: string;
  errorKind?: "not_found" | "permission" | "not_a_directory" | "other";
}

/** List the immediate children of a directory as structured DirEntry objects.
 *  Directories are returned first (alphabetical), then files (alphabetical).
 *  Ignored directory names (IGNORE_DIRS) are filtered out. */
export async function listDir(dirPath: string): Promise<ListDirResult> {
  try {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    const dirs: DirEntry[] = [];
    const files: DirEntry[] = [];

    for (const d of dirents) {
      const fullPath = resolve(dirPath, d.name);
      const isSymlink = d.isSymbolicLink();
      // Mirror listDirEntries at src/bun/index.ts:230 — treat symlinks as files
      // (avoids cycles without needing a followed-paths set).
      const isDirectory = !isSymlink && d.isDirectory();
      const entry: DirEntry = { name: d.name, fullPath, isDirectory, isSymlink };

      if (isDirectory) {
        if (IGNORE_DIRS.has(d.name)) continue;
        dirs.push(entry);
      } else {
        files.push(entry);
      }
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

/** Start (or no-op if already running) a recursive fs.watch for a workspace.
 *  On macOS recursive mode works natively; on other platforms the events are
 *  shallow and subtree changes will be missed. Tempest is macOS-only today. */
export function watchDirectoryTree(
  workspacePath: string,
  onChanged: DirectoryChangedCallback,
): void {
  if (watchers.has(workspacePath)) return;

  try {
    const watcher = watch(
      workspacePath,
      { recursive: true },
      (eventType, changedRelPath) => {
        if (changedRelPath === null) return;

        // Skip events for paths inside ignored directories (node_modules, etc.)
        // relative path uses forward slashes on macOS.
        const parts = String(changedRelPath).split("/");
        if (parts.some((p) => IGNORE_DIRS.has(p))) return;

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
  } catch (err) {
    console.error(
      `[file-tree-watcher] Failed to watch ${workspacePath}:`,
      err,
    );
  }
}

/** Stop watching a workspace. Flushes any pending debounce timers. */
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
