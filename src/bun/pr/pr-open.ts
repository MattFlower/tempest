// ============================================================
// PR Open Coordinator — Push and create draft PRs.
// Port of OpenPRCoordinator from Swift.
// ============================================================

import { PathResolver } from "../config/path-resolver";
import { loadConfig } from "../config/app-config";
import { parseGitHubRemote } from "./pr-url-lookup";
import { VCSType } from "../../shared/ipc-types";

const pathResolver = new PathResolver();

async function getJJPath(): Promise<string> {
  const config = await loadConfig();
  return pathResolver.resolve("jj", config.jjPath);
}

async function getGitPath(): Promise<string> {
  const config = await loadConfig();
  return pathResolver.resolve("git", config.gitPath);
}

async function getGHPath(): Promise<string> {
  const config = await loadConfig();
  return pathResolver.resolve("gh", config.ghPath);
}

async function run(
  binary: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const proc = Bun.spawn([binary, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(stderr.trim() || `Command failed: ${binary} ${args.join(" ")}`);
  }
  return stdout.trim();
}

async function currentChangeIsEmpty(jjPath: string, workspacePath: string): Promise<boolean> {
  const output = await run(jjPath, ["log", "-r", "@", "--no-graph", "-T", "empty"], workspacePath);
  return output === "true";
}

const EXCLUDED_BOOKMARKS = new Set(["main", "master"]);

/**
 * Resolve the bookmark (jj) or branch (git) for the current workspace.
 * For jj: checks @ first, then @- if @ is empty. Filters out main/master.
 */
async function resolveBookmark(
  workspacePath: string,
  vcsType: VCSType,
): Promise<string | undefined> {
  if (vcsType === VCSType.JJ) {
    const jjPath = await getJJPath();
    const isEmpty = await currentChangeIsEmpty(jjPath, workspacePath);
    const revision = isEmpty ? "@-" : "@";
    const output = await run(
      jjPath,
      ["log", "-r", revision, "--no-graph", "-T", "bookmarks"],
      workspacePath,
    );
    const bookmarks = output.trim().split(/\s+/).filter(Boolean);
    return bookmarks.find((b) => !EXCLUDED_BOOKMARKS.has(b));
  }
  return undefined;
}

/**
 * Compute the default PR title, body, and bookmark for the given workspace.
 */
export async function getDefaultTitleAndBody(
  workspacePath: string,
  repoPath: string,
  vcsType: VCSType,
): Promise<{ title: string; body: string; bookmarkName?: string }> {
  if (vcsType === VCSType.JJ) {
    const jjPath = await getJJPath();
    const bookmarkName = await resolveBookmark(workspacePath, vcsType);
    const title = (bookmarkName ?? "")
      .replace(/-/g, " ")
      .replace(/_/g, " ");

    const revision = (await currentChangeIsEmpty(jjPath, workspacePath)) ? "@-" : "@";
    const body = await run(
      jjPath,
      ["log", "-r", revision, "--no-graph", "-T", "description"],
      workspacePath,
    );
    return { title, body, bookmarkName };
  } else {
    const gitPath = await getGitPath();
    const title = await run(gitPath, ["log", "--format=%s", "-1"], workspacePath);
    const body = await run(gitPath, ["log", "--format=%b", "-1"], workspacePath);
    return { title, body };
  }
}

/**
 * Push changes and create a draft PR. Returns the PR URL.
 */
export async function openPR(
  workspacePath: string,
  repoPath: string,
  vcsType: VCSType,
  bookmarkName: string | undefined,
  title: string,
  body: string,
  draft: boolean = true,
): Promise<string> {
  if (vcsType === VCSType.JJ && bookmarkName) {
    await pushJJ(workspacePath, bookmarkName);
  } else {
    await pushGit(workspacePath);
  }

  return await createPR(repoPath, workspacePath, bookmarkName, title, body, draft);
}

/**
 * Push changes for an existing PR (no PR creation).
 */
export async function updatePR(
  workspacePath: string,
  vcsType: VCSType,
  bookmarkName?: string,
): Promise<void> {
  if (vcsType === VCSType.JJ && bookmarkName) {
    await pushJJ(workspacePath, bookmarkName);
  } else {
    await pushGit(workspacePath);
  }
}

// --- Push helpers ---

async function pushJJ(workspacePath: string, bookmarkName: string): Promise<void> {
  const jjPath = await getJJPath();

  // If current change is empty, target the parent instead
  const revision = (await currentChangeIsEmpty(jjPath, workspacePath)) ? "@-" : "@";

  // Set bookmark on the target revision
  await run(jjPath, ["bookmark", "set", bookmarkName, "-r", revision], workspacePath);

  // Track remote bookmark (ignore "already tracked" errors)
  try {
    await run(jjPath, ["bookmark", "track", `${bookmarkName}@origin`], workspacePath);
  } catch (err) {
    if (!(err instanceof Error && err.message.toLowerCase().includes("already tracked"))) {
      throw err;
    }
  }

  // Push
  await run(jjPath, ["git", "push", "-b", bookmarkName], workspacePath);
}

async function pushGit(workspacePath: string): Promise<void> {
  const gitPath = await getGitPath();
  await run(gitPath, ["push", "-u", "origin", "HEAD"], workspacePath);
}

// --- Create draft PR ---

async function createPR(
  repoPath: string,
  workspacePath: string,
  bookmarkName: string | undefined,
  title: string,
  body: string,
  draft: boolean,
): Promise<string> {
  const gitPath = await getGitPath();
  const remoteURL = await run(gitPath, ["remote", "get-url", "origin"], repoPath);

  const ownerRepo = parseGitHubRemote(remoteURL);
  if (!ownerRepo) {
    throw new Error(`Could not parse GitHub remote from '${remoteURL}'`);
  }

  const ghPath = await getGHPath();
  const args = ["pr", "create", ...(draft ? ["--draft"] : []), "--repo", ownerRepo];

  if (bookmarkName) {
    // JJ: bookmark name was provided by the caller
    args.push("--head", bookmarkName);
  } else {
    // Git: resolve the branch checked out in the workspace (worktree)
    const branch = await run(gitPath, ["rev-parse", "--abbrev-ref", "HEAD"], workspacePath);
    args.push("--head", branch);
  }

  args.push("--title", title, "--body", body);

  // Run gh from repoPath (which has .git) rather than the workspace path
  return await run(ghPath, args, repoPath);
}
