// ============================================================
// Markdown file reading and watching service.
// Reads markdown files and watches them for changes,
// pushing updates to the webview via RPC.
// ============================================================

import { watch, type FSWatcher } from "fs";
import { basename, dirname } from "path";
import { buildMarkdownHTML } from "./markdown-html-builder";

export interface MarkdownFileResult {
  content: string;  // Pre-rendered HTML (not raw markdown)
  fileName: string;
}

/**
 * Read a markdown file, render to HTML, and return the result.
 */
export async function readMarkdownFile(
  filePath: string,
): Promise<MarkdownFileResult> {
  try {
    const file = Bun.file(filePath);
    const markdown = await file.text();
    return { content: buildMarkdownHTML(markdown), fileName: basename(filePath) };
  } catch (err: any) {
    throw new Error(`Cannot read file: ${err?.message ?? String(err)}`);
  }
}

// --- File Watching ---

type FileChangedCallback = (filePath: string, content: string, deleted: boolean) => void;

const activeWatchers = new Map<string, FSWatcher>();

async function notifyCurrentFileState(
  filePath: string,
  onChanged: FileChangedCallback,
): Promise<void> {
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const markdown = await file.text();
      onChanged(filePath, buildMarkdownHTML(markdown), false);
    } else {
      onChanged(filePath, "", true);
    }
  } catch {
    onChanged(filePath, "", true);
  }
}

/**
 * Start watching a markdown file for changes.
 * When the file changes, calls the callback with the new content.
 * If already watching this path, the old watcher is replaced.
 */
export function watchMarkdownFile(
  filePath: string,
  onChanged: FileChangedCallback,
): void {
  // Clean up any existing watcher for this path
  unwatchMarkdownFile(filePath);

  const directoryPath = dirname(filePath);
  const watchedFileName = basename(filePath);

  try {
    // Watch the parent directory instead of the file itself so we survive
    // editor atomic-save flows that replace the file inode.
    const watcher = watch(directoryPath, async (_eventType, changedName) => {
      if (changedName !== null && basename(changedName) !== watchedFileName) {
        return;
      }

      await notifyCurrentFileState(filePath, onChanged);
    });

    activeWatchers.set(filePath, watcher);
  } catch (err) {
    console.error(`[markdown-service] Failed to watch ${filePath} in ${directoryPath}:`, err);
  }
}

/**
 * Stop watching a markdown file.
 */
export function unwatchMarkdownFile(filePath: string): void {
  const existing = activeWatchers.get(filePath);
  if (existing) {
    existing.close();
    activeWatchers.delete(filePath);
  }
}

/**
 * Stop all active file watchers. Called during shutdown.
 */
export function unwatchAll(): void {
  for (const [, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();
}
