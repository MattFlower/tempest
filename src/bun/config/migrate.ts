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

type Logger = (message: string) => void;

interface CopyResult {
  copied: boolean;
  hadError: boolean;
}

export interface MigrationOptions {
  tempestDir?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  warnLogger?: Logger;
  errorLogger?: Logger;
}

/**
 * One-time migration of data from legacy directories into ~/.config/tempest/.
 * Copies (not moves) files so originals are left intact.
 * Writes a .migrated marker to skip on subsequent launches.
 *
 * This function is synchronous and should be called before any data is read.
 * It will be removed in a future version once all users have migrated.
 */
export function runMigration(options: MigrationOptions = {}): void {
  const env = options.env ?? process.env;
  const tempestDir = options.tempestDir ?? TEMPEST_DIR;
  const homeDir = options.homeDir ?? homedir();
  const logger = options.logger ?? ((message: string) => console.log(message));
  const warnLogger = options.warnLogger ?? ((message: string) => console.warn(message));
  const errorLogger = options.errorLogger ?? ((message: string) => console.error(message));

  // Skip if custom directory is configured
  if (env.TEMPEST_CONFIG_DIR) return;

  const markerFile = join(tempestDir, ".migrated");

  // Fast path: already migrated
  if (existsSync(markerFile)) return;

  mkdirSync(tempestDir, { recursive: true });

  let migrated = false;
  let hadError = false;

  const absorb = (result: CopyResult): void => {
    migrated = migrated || result.copied;
    hadError = hadError || result.hadError;
  };

  // --- Migrate from ~/Library/Application Support/Tempest/ ---
  const appSupportDir = join(
    homeDir,
    "Library",
    "Application Support",
    "Tempest",
  );
  absorb(
    copyIfExists(
      join(appSupportDir, "session-state.json"),
      join(tempestDir, "session-state.json"),
      logger,
      errorLogger,
    ),
  );
  absorb(
    copyIfExists(
      join(appSupportDir, "ccusage-state.json"),
      join(tempestDir, "ccusage-state.json"),
      logger,
      errorLogger,
    ),
  );

  // --- Migrate from ~/.tempest/ ---
  const dotTempestDir = join(homeDir, ".tempest");
  if (existsSync(dotTempestDir)) {
    // Settings files (settings-{hash}.json)
    absorb(copyGlob(dotTempestDir, tempestDir, /^settings-.*\.json$/, logger, errorLogger));

    // MCP config files (mcp-{hash}.json)
    absorb(copyGlob(dotTempestDir, tempestDir, /^mcp-.*\.json$/, logger, errorLogger));

    // Webpage previews directory
    const oldPreviews = join(dotTempestDir, "webpage-previews");
    if (existsSync(oldPreviews)) {
      absorb(
        copyDirRecursive(
          oldPreviews,
          join(tempestDir, "webpage-previews"),
          logger,
          errorLogger,
        ),
      );
    }
  }

  if (migrated) {
    logger(`[migrate] Migration to ${tempestDir} complete`);
  }

  if (hadError) {
    warnLogger("[migrate] Migration encountered errors; will retry on next launch");
    return;
  }

  // Write marker after a successful full pass so we don't re-run.
  writeFileSync(markerFile, JSON.stringify({ migratedAt: new Date().toISOString() }));
}

function copyIfExists(
  src: string,
  dest: string,
  logger: Logger,
  errorLogger: Logger,
): CopyResult {
  try {
    if (existsSync(src) && !existsSync(dest)) {
      logger(`[migrate] Copying ${src} → ${dest}`);
      copyFileSync(src, dest);
      return { copied: true, hadError: false };
    }
  } catch (err) {
    errorLogger(`[migrate] Failed to copy ${src}: ${String(err)}`);
    return { copied: false, hadError: true };
  }
  return { copied: false, hadError: false };
}

function copyGlob(
  srcDir: string,
  destDir: string,
  pattern: RegExp,
  logger: Logger,
  errorLogger: Logger,
): CopyResult {
  let copied = false;
  let hadError = false;
  try {
    const files = readdirSync(srcDir).filter((f) => pattern.test(f));
    for (const file of files) {
      const result = copyIfExists(join(srcDir, file), join(destDir, file), logger, errorLogger);
      copied = copied || result.copied;
      hadError = hadError || result.hadError;
    }
  } catch (err) {
    errorLogger(`[migrate] Failed to scan ${srcDir}: ${String(err)}`);
    hadError = true;
  }
  return { copied, hadError };
}

function copyDirRecursive(
  srcDir: string,
  destDir: string,
  logger: Logger,
  errorLogger: Logger,
): CopyResult {
  let copied = false;
  let hadError = false;
  try {
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      const result = entry.isDirectory()
        ? copyDirRecursive(srcPath, destPath, logger, errorLogger)
        : copyIfExists(srcPath, destPath, logger, errorLogger);
      copied = copied || result.copied;
      hadError = hadError || result.hadError;
    }
  } catch (err) {
    errorLogger(`[migrate] Failed to copy directory ${srcDir}: ${String(err)}`);
    hadError = true;
  }
  return { copied, hadError };
}
