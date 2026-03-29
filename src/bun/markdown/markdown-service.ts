// ============================================================
// Markdown file reading and watching service.
// Reads markdown files and watches them for changes,
// pushing updates to the webview via RPC.
// ============================================================

import { watch, type FSWatcher } from "fs";
import { basename } from "path";
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

  try {
    const watcher = watch(filePath, async (eventType) => {
      if (eventType === "change") {
        try {
          const file = Bun.file(filePath);
          const markdown = await file.text();
          onChanged(filePath, buildMarkdownHTML(markdown), false);
        } catch {
          // File may have been deleted during read
          onChanged(filePath, "", true);
        }
      } else if (eventType === "rename") {
        // "rename" fires for deletions and editor save-and-replace.
        // Check if the file still exists at the original path.
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
    });

    activeWatchers.set(filePath, watcher);
  } catch (err) {
    console.error(`[markdown-service] Failed to watch ${filePath}:`, err);
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
