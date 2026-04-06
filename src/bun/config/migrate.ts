import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TEMPEST_DIR } from "./paths";

const MARKER_FILE = join(TEMPEST_DIR, ".migrated");

/**
 * One-time migration of data from legacy directories into ~/.config/tempest/.
 * Copies (not moves) files so originals are left intact.
 * Writes a .migrated marker to skip on subsequent launches.
 *
 * This function is synchronous and should be called before any data is read.
 * It will be removed in a future version once all users have migrated.
 */
export function runMigration(): void {
  // Skip if custom directory is configured
  if (process.env.TEMPEST_CONFIG_DIR) return;

  // Fast path: already migrated
  if (existsSync(MARKER_FILE)) return;

  mkdirSync(TEMPEST_DIR, { recursive: true });

  let migrated = false;

  // --- Migrate from ~/Library/Application Support/Tempest/ ---
  const appSupportDir = join(
    homedir(),
    "Library",
    "Application Support",
    "Tempest",
  );
  migrated =
    copyIfExists(
      join(appSupportDir, "session-state.json"),
      join(TEMPEST_DIR, "session-state.json"),
    ) || migrated;
  migrated =
    copyIfExists(
      join(appSupportDir, "ccusage-state.json"),
      join(TEMPEST_DIR, "ccusage-state.json"),
    ) || migrated;

  // --- Migrate from ~/.tempest/ ---
  const dotTempestDir = join(homedir(), ".tempest");
  if (existsSync(dotTempestDir)) {
    // Settings files (settings-{hash}.json)
    migrated = copyGlob(dotTempestDir, TEMPEST_DIR, /^settings-.*\.json$/) || migrated;

    // MCP config files (mcp-{hash}.json)
    migrated = copyGlob(dotTempestDir, TEMPEST_DIR, /^mcp-.*\.json$/) || migrated;

    // Webpage previews directory
    const oldPreviews = join(dotTempestDir, "webpage-previews");
    if (existsSync(oldPreviews)) {
      migrated = copyDirRecursive(oldPreviews, join(TEMPEST_DIR, "webpage-previews")) || migrated;
    }
  }

  if (migrated) {
    console.log("[migrate] Migration to ~/.config/tempest/ complete");
  }

  // Write marker so we don't re-run
  writeFileSync(MARKER_FILE, JSON.stringify({ migratedAt: new Date().toISOString() }));
}

function copyIfExists(src: string, dest: string): boolean {
  try {
    if (existsSync(src) && !existsSync(dest)) {
      console.log(`[migrate] Copying ${src} → ${dest}`);
      copyFileSync(src, dest);
      return true;
    }
  } catch (err) {
    console.error(`[migrate] Failed to copy ${src}: ${err}`);
  }
  return false;
}

function copyGlob(srcDir: string, destDir: string, pattern: RegExp): boolean {
  let copied = false;
  try {
    const files = readdirSync(srcDir).filter((f) => pattern.test(f));
    for (const file of files) {
      if (copyIfExists(join(srcDir, file), join(destDir, file))) {
        copied = true;
      }
    }
  } catch (err) {
    console.error(`[migrate] Failed to scan ${srcDir}: ${err}`);
  }
  return copied;
}

function copyDirRecursive(srcDir: string, destDir: string): boolean {
  let copied = false;
  try {
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      if (entry.isDirectory()) {
        if (copyDirRecursive(srcPath, destPath)) copied = true;
      } else {
        if (copyIfExists(srcPath, destPath)) copied = true;
      }
    }
  } catch (err) {
    console.error(`[migrate] Failed to copy directory ${srcDir}: ${err}`);
  }
  return copied;
}
