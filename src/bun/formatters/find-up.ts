// ============================================================
// Walk up from a starting directory looking for any of a set of files.
// Used by config-gated providers: Prettier, ruff, black, clang-format,
// rustfmt-toml-aware, etc.
//
// Stops at the workspace root if provided, else at the filesystem root.
// Returns the absolute path to the first match found, or null.
// ============================================================

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findUp(
  fromFilePath: string,
  candidates: readonly string[],
  workspacePath?: string,
): string | null {
  let dir = dirname(resolve(fromFilePath));
  const stop = workspacePath ? resolve(workspacePath) : "/";
  while (true) {
    for (const name of candidates) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch { /* ignore */ }
      }
    }
    if (dir === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null; // hit FS root
    dir = parent;
  }
}

/** Walk up looking for a file whose contents contain any of the given
 *  substrings. Used to detect `[tool.ruff]` / `[tool.black]` inside
 *  pyproject.toml without parsing TOML. Bounded to keep the cost low:
 *  reads at most `maxBytes` per file (default 64KiB). */
export function findUpWithMarker(
  fromFilePath: string,
  fileName: string,
  markers: readonly string[],
  workspacePath?: string,
  maxBytes = 64 * 1024,
): string | null {
  let dir = dirname(resolve(fromFilePath));
  const stop = workspacePath ? resolve(workspacePath) : "/";
  while (true) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) {
      try {
        const buf = readFileSync(candidate);
        const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
        const text = slice.toString("utf8");
        if (markers.some((m) => text.includes(m))) return candidate;
      } catch { /* ignore */ }
    }
    if (dir === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
