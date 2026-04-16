// ============================================================
// JJ commit operations — log, new, fetch, push, undo, describe,
// abandon, changed files, file diff, bookmarks.
// Used by the JJ VCS View frontend.
// ============================================================

import { PathResolver } from "../config/path-resolver";
import { loadConfig } from "../config/app-config";
import type {
  JJRevision,
  JJLogResult,
  JJChangedFile,
  JJBookmark,
  VCSFileChangeType,
  VCSFileDiffResult,
} from "../../shared/ipc-types";
import { detectLanguage } from "./shared";

const pathResolver = new PathResolver();

// Cache the resolved jj path, but invalidate when config.jjPath changes.
let cachedJJPath: string | undefined;
let cachedJJPathKey: string | undefined;

async function getJJPath(): Promise<string> {
  const config = await loadConfig();
  const cacheKey = config.jjPath ?? "__default__";
  if (cachedJJPath && cachedJJPathKey === cacheKey) {
    return cachedJJPath;
  }
  cachedJJPath = pathResolver.resolve("jj", config.jjPath);
  cachedJJPathKey = cacheKey;
  return cachedJJPath;
}

async function runJJ(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const jjPath = await getJJPath();
  const proc = Bun.spawn([jjPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

async function runJJOrThrow(args: string[], cwd: string): Promise<string> {
  const { stdout, stderr, exitCode } = await runJJ(args, cwd);
  if (exitCode !== 0) {
    throw new Error(`jj ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`);
  }
  return stdout;
}

// --- Template for jj log ---
// Single-line template with \x02 start marker and \x03 end marker.
// When run WITH graph, jj prefixes each line with graph chars.
// We parse the graph prefix from each line by finding the \x02 marker.
const LOG_TEMPLATE = `
"\\x02" ++
change_id.short() ++ "\\x00" ++
commit_id.short() ++ "\\x00" ++
description.first_line() ++ "\\x00" ++
author.name() ++ "\\x00" ++
author.email() ++ "\\x00" ++
author.timestamp().ago() ++ "\\x00" ++
bookmarks.map(|b| b.name()).join(",") ++ "\\x00" ++
if(self.working_copies(), "true", "false") ++ "\\x00" ++
if(self.empty(), "true", "false") ++ "\\x00" ++
if(self.immutable(), "true", "false") ++ "\\x03"
`.trim().replace(/\n/g, "");

const DEFAULT_REVSET = 'heads(::@ & ::trunk())..@';

// --- Workspace list parsing ---

// Prefix-matching workspace map. jj workspace list and change_id.short()
// can produce different-length IDs, so we match by prefix.
interface WorkspaceMap {
  get(changeId: string): string[];
}

async function buildWorkspaceMap(
  workspacePath: string,
): Promise<WorkspaceMap> {
  const entries: { name: string; changeId: string }[] = [];
  try {
    const output = await runJJOrThrow(["workspace", "list"], workspacePath);
    for (const line of output.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const name = line.substring(0, colonIdx).trim();
      const rest = line.substring(colonIdx + 1).trim();
      const changeId = rest.split(/\s+/)[0];
      if (name && changeId) {
        entries.push({ name, changeId });
      }
    }
  } catch {
    // degrade gracefully
  }
  return {
    get(changeId: string): string[] {
      const result: string[] = [];
      for (const e of entries) {
        if (
          changeId.startsWith(e.changeId) ||
          e.changeId.startsWith(changeId)
        ) {
          result.push(e.name);
        }
      }
      return result;
    },
  };
}

// --- Public API ---

export async function jjLog(
  workspacePath: string,
  revset?: string,
): Promise<JJLogResult> {
  const rs = revset || DEFAULT_REVSET;

  // Run jj log WITH graph (no --no-graph) and get workspace mapping in parallel
  const [logOutput, workspaceMap] = await Promise.all([
    runJJOrThrow(
      ["log", "--color=never", "-r", rs, "-T", LOG_TEMPLATE],
      workspacePath,
    ),
    buildWorkspaceMap(workspacePath),
  ]);

  // Parse: lines with \x02...\x03 are revision lines; others are graph-only lines.
  const revisions: JJRevision[] = [];
  let currentChangeId = "";
  let currentTrailingLines: string[] = [];

  for (const line of logOutput.split("\n")) {
    const stxIdx = line.indexOf("\x02");
    const etxIdx = line.indexOf("\x03");

    if (stxIdx !== -1 && etxIdx !== -1 && etxIdx > stxIdx) {
      // This is a revision line.
      // If there's a previous revision, attach the trailing lines to it.
      if (revisions.length > 0) {
        revisions[revisions.length - 1]!.trailingGraphLines = currentTrailingLines;
      }
      currentTrailingLines = [];

      const graphPrefix = line.substring(0, stxIdx);
      const data = line.substring(stxIdx + 1, etxIdx);
      const parts = data.split("\x00");
      if (parts.length < 10) continue;

      const changeId = parts[0]!;
      const rev: JJRevision = {
        changeId,
        commitId: parts[1]!,
        description: parts[2]!,
        author: parts[3]!,
        email: parts[4]!,
        timestamp: parts[5]!,
        bookmarks: parts[6]! ? parts[6]!.split(",").filter(Boolean) : [],
        workingCopies: workspaceMap.get(changeId) ?? [],
        isWorkingCopy: parts[7] === "true",
        isEmpty: parts[8] === "true",
        isImmutable: parts[9]?.trim() === "true",
        nodeGraphPrefix: graphPrefix,
        trailingGraphLines: [],
      };

      if (rev.isWorkingCopy) {
        currentChangeId = rev.changeId;
      }

      revisions.push(rev);
    } else {
      // Graph-only line (continuation, merge, elided, blank)
      currentTrailingLines.push(line);
    }
  }

  // Attach trailing lines to the last revision
  if (revisions.length > 0) {
    revisions[revisions.length - 1]!.trailingGraphLines = currentTrailingLines;
  }

  return { revisions, currentChangeId };
}

export async function jjNew(
  workspacePath: string,
  revisions?: string[],
): Promise<{ success: boolean; error?: string }> {
  const args = ["new"];
  if (revisions && revisions.length > 0) {
    args.push(...revisions);
  }
  const { stderr, exitCode } = await runJJ(args, workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjFetch(
  workspacePath: string,
  remote?: string,
  allRemotes?: boolean,
): Promise<{ success: boolean; error?: string }> {
  const args = ["git", "fetch"];
  if (allRemotes) {
    args.push("--all-remotes");
  } else if (remote) {
    args.push("--remote", remote);
  }
  const { stderr, exitCode } = await runJJ(args, workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjPush(
  workspacePath: string,
  bookmark?: string,
  allTracked?: boolean,
): Promise<{ success: boolean; error?: string }> {
  const args = ["git", "push"];
  if (allTracked) {
    args.push("--all");
  } else if (bookmark) {
    args.push("-b", bookmark);
  }
  const { stderr, exitCode } = await runJJ(args, workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjUndo(
  workspacePath: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(["undo"], workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjDescribe(
  workspacePath: string,
  revision: string,
  description: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(
    ["describe", revision, "-m", description],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjAbandon(
  workspacePath: string,
  revision: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(
    ["abandon", revision],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

function parseChangedFilesOutput(output: string): JJChangedFile[] {
  const files: JJChangedFile[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: "M path/to/file" or "A path/to/file" or "D path/to/file" or "R {old => new}"
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;

    const status = trimmed.substring(0, spaceIdx);
    const path = trimmed.substring(spaceIdx + 1).trim();

    let changeType: VCSFileChangeType;
    switch (status) {
      case "M":
        changeType = "modified";
        break;
      case "A":
        changeType = "added";
        break;
      case "D":
        changeType = "deleted";
        break;
      case "R":
        changeType = "renamed";
        break;
      default:
        changeType = "modified";
    }

    files.push({ path, changeType });
  }

  return files;
}

export async function jjGetChangedFiles(
  workspacePath: string,
  revision: string,
): Promise<JJChangedFile[]> {
  const output = await runJJOrThrow(
    ["diff", "--summary", "-r", revision],
    workspacePath,
  );
  return parseChangedFilesOutput(output);
}

export async function jjGetRangeChangedFiles(
  workspacePath: string,
  fromRevision: string,
  toRevision: string,
): Promise<JJChangedFile[]> {
  const output = await runJJOrThrow(
    ["diff", "--summary", "--from", fromRevision, "--to", toRevision],
    workspacePath,
  );
  return parseChangedFilesOutput(output);
}

export async function jjGetRangeFileDiff(
  workspacePath: string,
  fromRevision: string,
  toRevision: string,
  filePath: string,
): Promise<VCSFileDiffResult> {
  const language = detectLanguage(filePath);

  let originalContent = "";
  let modifiedContent = "";

  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", fromRevision, filePath],
      workspacePath,
    );
    if (exitCode === 0) {
      originalContent = stdout;
    }
  } catch {
    // File didn't exist at from revision — new file
  }

  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", toRevision, filePath],
      workspacePath,
    );
    if (exitCode === 0) {
      modifiedContent = stdout;
    }
  } catch {
    // File deleted at to revision
  }

  return { originalContent, modifiedContent, filePath, language };
}

export async function jjGetFileDiff(
  workspacePath: string,
  revision: string,
  filePath: string,
): Promise<VCSFileDiffResult> {
  const language = detectLanguage(filePath);

  let originalContent = "";
  let modifiedContent = "";

  // Get the parent revision content and current revision content
  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", `${revision}-`, filePath],
      workspacePath,
    );
    if (exitCode === 0) {
      originalContent = stdout;
    }
  } catch {
    // File didn't exist in parent — new file
  }

  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", revision, filePath],
      workspacePath,
    );
    if (exitCode === 0) {
      modifiedContent = stdout;
    }
  } catch {
    // File deleted in this revision
  }

  return { originalContent, modifiedContent, filePath, language };
}

export async function jjGetBookmarks(
  workspacePath: string,
): Promise<JJBookmark[]> {
  // Use jj bookmark list with template for structured output
  const BOOKMARK_TEMPLATE =
    `name ++ "\\x00" ++ if(remote, remote, "") ++ "\\x00" ++ if(tracked, "true", "false") ++ "\\n"`;

  let output: string;
  try {
    output = await runJJOrThrow(
      ["bookmark", "list", "--all-remotes", "-T", BOOKMARK_TEMPLATE],
      workspacePath,
    );
  } catch {
    // Fallback: simple list
    try {
      output = await runJJOrThrow(["bookmark", "list", "--all-remotes"], workspacePath);
      // Parse simple format: "name: commitid description"
      const bookmarks: JJBookmark[] = [];
      for (const line of output.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const fullName = line.substring(0, colonIdx).trim();
        // Parse "name@remote" format
        const atIdx = fullName.indexOf("@");
        if (atIdx !== -1) {
          bookmarks.push({
            name: fullName.substring(0, atIdx),
            remote: fullName.substring(atIdx + 1),
            isTracked: true,
          });
        } else {
          bookmarks.push({ name: fullName, isTracked: true });
        }
      }
      return deduplicateBookmarks(bookmarks);
    } catch {
      return [];
    }
  }

  const bookmarks: JJBookmark[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\x00");
    if (parts.length < 3) continue;
    bookmarks.push({
      name: parts[0]!,
      remote: parts[1] || undefined,
      isTracked: parts[2]?.trim() === "true",
    });
  }

  return deduplicateBookmarks(bookmarks);
}

export async function jjEdit(
  workspacePath: string,
  revision: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(
    ["edit", revision],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjBookmarkSet(
  workspacePath: string,
  revision: string,
  name: string,
  track: boolean,
): Promise<{ success: boolean; error?: string }> {
  // Create/move bookmark to the revision
  const { stderr, exitCode } = await runJJ(
    ["bookmark", "set", name, "-r", revision],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }

  // If tracking requested, track the bookmark on origin
  if (track) {
    const { stderr: stderr2, exitCode: exitCode2 } = await runJJ(
      ["bookmark", "track", `${name}@origin`],
      workspacePath,
    );
    // Tracking may fail if remote doesn't have the bookmark yet — that's OK
    if (exitCode2 !== 0 && !stderr2.includes("not found")) {
      return { success: false, error: stderr2.trim() };
    }
  }

  return { success: true };
}

export async function jjRebase(
  workspacePath: string,
  revision: string,
  destination: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(
    ["rebase", "-r", revision, "-d", destination],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

export async function jjGetRestorePreview(
  workspacePath: string,
  targetRevision: string,
  sourceRevision: string,
  filePath: string,
): Promise<VCSFileDiffResult> {
  const language = detectLanguage(filePath);

  let originalContent = "";
  let modifiedContent = "";

  // Current content in target revision (what the file looks like now)
  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", targetRevision, filePath],
      workspacePath,
    );
    if (exitCode === 0) originalContent = stdout;
  } catch {
    // File may not exist in target revision
  }

  // Content in source revision (what the file would become after restore)
  try {
    const { stdout, exitCode } = await runJJ(
      ["file", "show", "-r", sourceRevision, filePath],
      workspacePath,
    );
    if (exitCode === 0) modifiedContent = stdout;
  } catch {
    // File may not exist in source revision
  }

  return { originalContent, modifiedContent, filePath, language };
}

export async function jjRestore(
  workspacePath: string,
  targetRevision: string,
  sourceRevision: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runJJ(
    ["restore", "--from", sourceRevision, "--to", targetRevision, filePath],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() };
  }
  return { success: true };
}

/** Deduplicate bookmarks — prefer local over remote entries with same name. */
function deduplicateBookmarks(bookmarks: JJBookmark[]): JJBookmark[] {
  const seen = new Map<string, JJBookmark>();
  for (const b of bookmarks) {
    const existing = seen.get(b.name);
    if (!existing || (!b.remote && existing.remote)) {
      seen.set(b.name, b);
    }
  }
  return Array.from(seen.values());
}
