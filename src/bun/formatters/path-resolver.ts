// ============================================================
// Binary path resolution for formatter CLIs.
//
// Two lookup modes:
//   1. `whichGlobal(name)` — uses the cached login-shell PATH from
//      src/bun/config/path-resolver.ts. Result is memoized per binary
//      (positive and negative), since installing a formatter
//      mid-session is rare.
//   2. `resolveProjectBinary(workspacePath, name)` — checks
//      <workspacePath>/node_modules/.bin/<name>. Not memoized because
//      the answer varies per workspacePath and the file could appear
//      after `npm install`.
//
// `resolvePreferProject` is the convenience the Prettier provider
// uses: project-local first, then global PATH.
// ============================================================

import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { getResolvedPATH } from "../config/path-resolver";

const cache = new Map<string, string | null>();

export function whichGlobal(name: string): string | null {
  if (cache.has(name)) return cache.get(name) ?? null;
  for (const dir of getResolvedPATH().split(":")) {
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      cache.set(name, candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  cache.set(name, null);
  return null;
}

export function resolveProjectBinary(
  workspacePath: string | undefined,
  name: string,
): string | null {
  if (!workspacePath) return null;
  const candidate = join(workspacePath, "node_modules", ".bin", name);
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

/** Project node_modules first, then global PATH. Used by Prettier so the
 *  project's pinned version wins over a globally-installed one. */
export function resolvePreferProject(
  workspacePath: string | undefined,
  name: string,
): string | null {
  return resolveProjectBinary(workspacePath, name) ?? whichGlobal(name);
}
