// ============================================================
// Git commit operations — staging, committing, pushing, status.
// Used by the VCS View frontend.
// ============================================================

import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { PathResolver } from "../config/path-resolver";
import { loadConfig } from "../config/app-config";
import type {
  VCSFileEntry,
  VCSFileChangeType,
  VCSStatusResult,
  VCSCommitResult,
  VCSFileDiffResult,
  GitCommitEntry,
  GitCommitLogResult,
  GitScopedFileEntry,
  GitScopedFilesResult,
  GitBranchInfo,
  GitBranchListResult,
  GitOpResult,
} from "../../shared/ipc-types";
import { DiffScope } from "../../shared/ipc-types";
import { detectLanguage, detectBaseBranch } from "./shared";

const pathResolver = new PathResolver();

// Cache the resolved git path, but invalidate when config.gitPath changes.
let cachedGitPath: string | undefined;
let cachedGitPathKey: string | undefined;

async function getGitPath(): Promise<string> {
  const config = await loadConfig();
  const cacheKey = config.gitPath ?? "__default__";
  if (cachedGitPath && cachedGitPathKey === cacheKey) {
    return cachedGitPath;
  }
  cachedGitPath = pathResolver.resolve("git", config.gitPath);
  cachedGitPathKey = cacheKey;
  return cachedGitPath;
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const gitPath = await getGitPath();
  const proc = Bun.spawn([gitPath, "-c", "color.ui=never", ...args], {
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

async function runGitOrThrow(args: string[], cwd: string): Promise<string> {
  const { stdout, stderr, exitCode } = await runGit(args, cwd);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`);
  }
  return stdout;
}

// --- Status parsing (git status --porcelain=v2) ---

function parseStatusV2(output: string): VCSFileEntry[] {
  const files: VCSFileEntry[] = [];
  const lines = output.split("\n").filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.startsWith("# ")) continue; // header lines

    if (line.startsWith("1 ")) {
      // Ordinary changed entry: 1 XY sub mH mI mW hH hI path
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const path = parts.slice(8).join(" ");
      const indexStatus = xy[0]!;
      const worktreeStatus = xy[1]!;

      // If index has changes, it's staged
      if (indexStatus !== "." && indexStatus !== "?") {
        files.push({
          path,
          changeType: statusCharToChangeType(indexStatus),
          staged: true,
        });
      }
      // If worktree has changes, it's unstaged
      if (worktreeStatus !== "." && worktreeStatus !== "?") {
        files.push({
          path,
          changeType: statusCharToChangeType(worktreeStatus),
          staged: false,
        });
      }
    } else if (line.startsWith("2 ")) {
      // Renamed/copied entry: 2 XY sub mH mI mW hH hI X<score> path\torigPath
      const tabIdx = line.indexOf("\t");
      const beforeTab = line.substring(0, tabIdx);
      const afterTab = line.substring(tabIdx + 1);
      const parts = beforeTab.split(" ");
      const xy = parts[1] ?? "..";
      const pathPart = parts.slice(9).join(" ");
      const oldPath = afterTab;
      const indexStatus = xy[0]!;
      const worktreeStatus = xy[1]!;

      if (indexStatus !== "." && indexStatus !== "?") {
        files.push({
          path: pathPart,
          oldPath,
          changeType: "renamed",
          staged: true,
        });
      }
      if (worktreeStatus !== "." && worktreeStatus !== "?") {
        files.push({
          path: pathPart,
          oldPath,
          changeType: "renamed",
          staged: false,
        });
      }
    } else if (line.startsWith("u ")) {
      // Unmerged entry: u XY sub m1 m2 m3 hH hI hW path
      const parts = line.split(" ");
      const path = parts.slice(10).join(" ");
      files.push({
        path,
        changeType: "modified",
        staged: false,
      });
    } else if (line.startsWith("? ")) {
      // Untracked: ? path
      const path = line.substring(2);
      files.push({
        path,
        changeType: "untracked",
        staged: false,
      });
    }
  }

  return files;
}

function statusCharToChangeType(ch: string): VCSFileChangeType {
  switch (ch) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

// --- Public API ---

export async function getVCSStatus(
  workspacePath: string,
): Promise<VCSStatusResult> {
  const statusOutput = await runGitOrThrow(
    ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    workspacePath,
  );

  const files = parseStatusV2(statusOutput);

  // Parse branch from status header
  let branch = "";
  let ahead = 0;
  let behind = 0;
  for (const line of statusOutput.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        ahead = parseInt(match[1]!, 10);
        behind = parseInt(match[2]!, 10);
      }
    }
  }

  return { branch, files, ahead, behind };
}

export async function vcsStageFiles(
  workspacePath: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  await runGitOrThrow(["add", "--", ...paths], workspacePath);
}

export async function vcsUnstageFiles(
  workspacePath: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  await runGitOrThrow(["restore", "--staged", "--", ...paths], workspacePath);
}

export async function vcsStageAll(workspacePath: string): Promise<void> {
  await runGitOrThrow(["add", "-A"], workspacePath);
}

export async function vcsUnstageAll(workspacePath: string): Promise<void> {
  await runGitOrThrow(["reset", "HEAD"], workspacePath);
}

export async function vcsRevertFiles(
  workspacePath: string,
  paths: string[],
): Promise<{ success: boolean; error?: string }> {
  if (paths.length === 0) return { success: true };

  try {
    // Get status to determine each file's change type and staged state.
    // A file can appear twice (once staged, once unstaged), so collect all
    // entries per path to handle both states correctly.
    const status = await getVCSStatus(workspacePath);
    const fileEntries = new Map<string, VCSFileEntry[]>();
    for (const f of status.files) {
      const existing = fileEntries.get(f.path);
      if (existing) {
        existing.push(f);
      } else {
        fileEntries.set(f.path, [f]);
      }
    }

    const trackedPaths = new Set<string>();
    const untrackedPaths = new Set<string>();
    const stagedPaths = new Set<string>();

    for (const p of paths) {
      const entries = fileEntries.get(p);
      if (!entries) continue;

      const hasStagedEntry = entries.some((entry) => entry.staged);
      const hasTrackedEntry = entries.some((entry) => entry.changeType !== "untracked");
      const hasOnlyUntrackedEntries = entries.every((entry) => entry.changeType === "untracked");

      if (hasStagedEntry) stagedPaths.add(p);
      if (hasTrackedEntry) trackedPaths.add(p);
      if (hasOnlyUntrackedEntries) untrackedPaths.add(p);
    }

    // Unstage any staged files first
    if (stagedPaths.size > 0) {
      await runGitOrThrow(["restore", "--staged", "--", ...stagedPaths], workspacePath);
    }

    // Restore tracked files from HEAD
    if (trackedPaths.size > 0) {
      await runGitOrThrow(["checkout", "HEAD", "--", ...trackedPaths], workspacePath);
    }

    // Delete untracked files
    for (const p of untrackedPaths) {
      const fullPath = join(workspacePath, p);
      try {
        if (await Bun.file(fullPath).exists()) {
          await unlink(fullPath);
        }
      } catch {
        // Ignore individual file deletion errors
      }
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) };
  }
}

export async function vcsCommit(
  workspacePath: string,
  message: string,
  amend: boolean,
): Promise<VCSCommitResult> {
  const args = ["commit", "-m", message];
  if (amend) args.push("--amend");

  const { stdout, stderr, exitCode } = await runGit(args, workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || "Commit failed" };
  }

  // Extract commit hash from output
  const hashMatch = stdout.match(/\[[\w/]+ ([a-f0-9]+)\]/);
  return {
    success: true,
    commitHash: hashMatch?.[1],
  };
}

export async function vcsPush(
  workspacePath: string,
): Promise<{ success: boolean; error?: string }> {
  const { stderr, exitCode } = await runGit(["push"], workspacePath);
  if (exitCode !== 0) {
    // Try push with upstream set
    const branchOutput = await runGitOrThrow(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      workspacePath,
    );
    const branch = branchOutput.trim();
    const { stderr: stderr2, exitCode: exitCode2 } = await runGit(
      ["push", "--set-upstream", "origin", branch],
      workspacePath,
    );
    if (exitCode2 !== 0) {
      return { success: false, error: stderr2.trim() || stderr.trim() || "Push failed" };
    }
  }
  return { success: true };
}

export async function vcsGetFileDiff(
  workspacePath: string,
  filePath: string,
  staged: boolean,
): Promise<VCSFileDiffResult> {
  const language = detectLanguage(filePath);

  // Get the original content (from HEAD or index)
  let originalContent = "";
  let modifiedContent = "";

  if (staged) {
    // Staged: original = HEAD, modified = index
    try {
      originalContent = await runGitOrThrow(
        ["show", `HEAD:${filePath}`],
        workspacePath,
      );
    } catch {
      // New file — no HEAD version
    }
    try {
      modifiedContent = await runGitOrThrow(
        ["show", `:${filePath}`],
        workspacePath,
      );
    } catch {
      // Deleted from index
    }
  } else {
    // Unstaged: original = index (or HEAD if not staged), modified = working tree
    try {
      modifiedContent = await Bun.file(join(workspacePath, filePath)).text();
    } catch {
      // File may not exist on disk (e.g. deleted)
    }
    try {
      originalContent = await runGitOrThrow(
        ["show", `:${filePath}`],
        workspacePath,
      );
    } catch {
      try {
        originalContent = await runGitOrThrow(
          ["show", `HEAD:${filePath}`],
          workspacePath,
        );
      } catch {
        // Untracked file — no original
      }
    }
  }

  return { originalContent, modifiedContent, filePath, language };
}

// --- Git Commit/Scope Selection ---

export async function gitGetRecentCommits(
  workspacePath: string,
  count?: number,
): Promise<GitCommitLogResult> {
  const n = count ?? 50;
  const format = "%h%x00%H%x00%s%x00%an%x00%ar";
  const output = await runGitOrThrow(
    ["log", `--pretty=format:${format}`, `-n`, `${n}`],
    workspacePath,
  );

  const commits: GitCommitEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\x00");
    if (parts.length < 5) continue;
    commits.push({
      hash: parts[0]!,
      fullHash: parts[1]!,
      message: parts[2]!,
      author: parts[3]!,
      date: parts[4]!,
    });
  }

  const branchOutput = await runGitOrThrow(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    workspacePath,
  );

  return { commits, branch: branchOutput.trim() };
}

function parseNameStatus(output: string): GitScopedFileEntry[] {
  const files: GitScopedFileEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const statusCode = parts[0]!;
    if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
      // Rename/copy: R100\told\tnew
      files.push({
        path: parts[2] ?? parts[1]!,
        oldPath: parts[1],
        changeType: statusCode.startsWith("R") ? "renamed" : "copied",
      });
    } else {
      files.push({
        path: parts[1]!,
        changeType: statusCharToChangeType(statusCode[0] ?? "M"),
      });
    }
  }
  return files;
}

export async function gitGetScopedFiles(
  workspacePath: string,
  scope: DiffScope,
  commitRef?: string,
): Promise<GitScopedFilesResult> {
  if (scope === DiffScope.SingleCommit && commitRef) {
    const output = await runGitOrThrow(
      ["diff-tree", "--no-commit-id", "-r", "--name-status", commitRef],
      workspacePath,
    );
    const files = parseNameStatus(output);

    // Get commit message for summary
    const msgOutput = await runGitOrThrow(
      ["log", "--format=%h — %s", "-n", "1", commitRef],
      workspacePath,
    );

    return { files, summary: msgOutput.trim() };
  }

  if (scope === DiffScope.SinceTrunk) {
    const baseBranch = await detectBaseBranch(workspacePath, runGitOrThrow);
    const mergeBase = (
      await runGitOrThrow(["merge-base", "HEAD", baseBranch], workspacePath)
    ).trim();

    const output = await runGitOrThrow(
      ["diff", "--name-status", `${mergeBase}..HEAD`],
      workspacePath,
    );
    const files = parseNameStatus(output);

    // Count commits since trunk
    const countOutput = await runGitOrThrow(
      ["rev-list", "--count", `${mergeBase}..HEAD`],
      workspacePath,
    );
    const count = parseInt(countOutput.trim(), 10);

    return {
      files,
      summary: `${count} commit${count !== 1 ? "s" : ""} since ${baseBranch}`,
    };
  }

  // CurrentChange — shouldn't be called for this scope, but handle gracefully
  return { files: [], summary: "" };
}

export async function gitGetScopedFileDiff(
  workspacePath: string,
  scope: DiffScope,
  filePath: string,
  commitRef?: string,
): Promise<VCSFileDiffResult> {
  const language = detectLanguage(filePath);
  let originalContent = "";
  let modifiedContent = "";

  if (scope === DiffScope.SingleCommit && commitRef) {
    try {
      originalContent = await runGitOrThrow(
        ["show", `${commitRef}~1:${filePath}`],
        workspacePath,
      );
    } catch {
      // New file in this commit
    }
    try {
      modifiedContent = await runGitOrThrow(
        ["show", `${commitRef}:${filePath}`],
        workspacePath,
      );
    } catch {
      // Deleted in this commit
    }
  } else if (scope === DiffScope.SinceTrunk) {
    const baseBranch = await detectBaseBranch(workspacePath, runGitOrThrow);
    const mergeBase = (
      await runGitOrThrow(["merge-base", "HEAD", baseBranch], workspacePath)
    ).trim();

    try {
      originalContent = await runGitOrThrow(
        ["show", `${mergeBase}:${filePath}`],
        workspacePath,
      );
    } catch {
      // New file since trunk
    }
    try {
      modifiedContent = await runGitOrThrow(
        ["show", `HEAD:${filePath}`],
        workspacePath,
      );
    } catch {
      // Deleted since trunk
    }
  }

  return { originalContent, modifiedContent, filePath, language };
}

// --- Branch / Remote operations ---

export async function gitListBranchesAndRemotes(
  workspacePath: string,
): Promise<GitBranchListResult> {
  const remotesOut = await runGitOrThrow(["remote"], workspacePath);
  const remotes = remotesOut
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const headOut = await runGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    workspacePath,
  );
  const current =
    headOut.exitCode === 0 && headOut.stdout.trim() !== "HEAD"
      ? headOut.stdout.trim()
      : null;

  const refsOut = await runGitOrThrow(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/"],
    workspacePath,
  );

  const branches: GitBranchInfo[] = [];
  for (const raw of refsOut.split("\n")) {
    const name = raw.trim();
    if (!name) continue;
    if (name.endsWith("/HEAD")) continue;

    const matchedRemote = remotes.find((r) => name.startsWith(`${r}/`));
    if (matchedRemote) {
      branches.push({
        name,
        isRemote: true,
        remote: matchedRemote,
        isCurrent: false,
      });
    } else {
      branches.push({
        name,
        isRemote: false,
        isCurrent: name === current,
      });
    }
  }

  branches.sort((a, b) => {
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return { branches, current, remotes };
}

export async function gitPull(workspacePath: string): Promise<GitOpResult> {
  const { stdout, stderr, exitCode } = await runGit(["pull"], workspacePath);
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || stdout.trim() || "Pull failed" };
  }
  return { success: true, output: stdout.trim() };
}

export async function gitFetchAll(workspacePath: string): Promise<GitOpResult> {
  const { stdout, stderr, exitCode } = await runGit(
    ["fetch", "--all", "--prune"],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || "Fetch failed" };
  }
  return { success: true, output: (stdout + stderr).trim() };
}

export async function gitPushBranch(
  workspacePath: string,
  branch: string,
  remote: string,
): Promise<GitOpResult> {
  const { stdout, stderr, exitCode } = await runGit(
    ["push", "--set-upstream", remote, branch],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || "Push failed" };
  }
  return { success: true, output: (stdout + stderr).trim() };
}

export async function gitMergeBranch(
  workspacePath: string,
  branch: string,
): Promise<GitOpResult> {
  const { stdout, stderr, exitCode } = await runGit(
    ["merge", "--no-edit", branch],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || stdout.trim() || "Merge failed" };
  }
  return { success: true, output: stdout.trim() };
}

export async function gitRebaseOnto(
  workspacePath: string,
  branch: string,
): Promise<GitOpResult> {
  const { stdout, stderr, exitCode } = await runGit(
    ["rebase", branch],
    workspacePath,
  );
  if (exitCode !== 0) {
    return { success: false, error: stderr.trim() || stdout.trim() || "Rebase failed" };
  }
  return { success: true, output: stdout.trim() };
}
