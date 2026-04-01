// ============================================================
// PR URL Lookup — Resolves the GitHub PR URL for the current branch.
// Port of OpenPRCoordinator.lookupPRURL from Swift.
// ============================================================

import { PathResolver } from "../config/path-resolver";

const pathResolver = new PathResolver();

/**
 * Parse a GitHub remote URL (HTTPS or SSH) into "owner/repo".
 * Returns null if the remote is not a GitHub URL.
 */
export function parseGitHubRemote(remote: string): string | null {
  const trimmed = remote.trim();

  // HTTPS: https://github.com/owner/repo.git
  if (trimmed.includes("github.com/")) {
    try {
      const url = new URL(trimmed);
      const components = url.pathname.split("/").filter(Boolean);
      if (components.length < 2) return null;
      const owner = components[0];
      const repo = components[1].replace(/\.git$/, "");
      return `${owner}/${repo}`;
    } catch {
      return null;
    }
  }

  // SSH: git@github.com:owner/repo.git
  if (trimmed.includes("github.com:")) {
    const parts = trimmed.split(":");
    if (parts.length !== 2) return null;
    const path = parts[1].replace(/\.git$/, "");
    return path;
  }

  return null;
}

/**
 * Look up the PR URL for the given branch in a repository.
 *
 * @param repoPath  Path to the repo root (must contain .git). Used for
 *                  `git remote` and `gh pr view` — important because jj
 *                  workspaces don't have their own .git directory.
 * @param branch    The branch or bookmark name to look up. For jj repos
 *                  this is the bookmark name (resolved by the VCS provider),
 *                  for git repos it's the branch name.
 */
export async function lookupPRUrl(
  repoPath: string,
  branch: string,
): Promise<{ url: string } | { error: string }> {
  // 1. Get remote URL
  let gitPath: string;
  try {
    gitPath = pathResolver.resolve("git");
  } catch {
    return { error: "git not found" };
  }

  const remoteProc = Bun.spawn([gitPath, "remote", "get-url", "origin"], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const remoteOut = await new Response(remoteProc.stdout).text();
  const remoteErr = await new Response(remoteProc.stderr).text();
  await remoteProc.exited;

  if (remoteProc.exitCode !== 0) {
    return { error: `Could not get git remote: ${remoteErr.trim()}` };
  }

  // 2. Parse owner/repo
  const ownerRepo = parseGitHubRemote(remoteOut);
  if (!ownerRepo) {
    return { error: `Could not parse GitHub remote from '${remoteOut.trim()}'` };
  }

  // 3. Look up PR via gh CLI
  let ghPath: string;
  try {
    ghPath = pathResolver.resolve("gh");
  } catch {
    return { error: "gh CLI not found. Install it with: brew install gh" };
  }

  const ghProc = Bun.spawn(
    [ghPath, "pr", "view", branch, "--repo", ownerRepo, "--json", "url"],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
  );
  const ghOut = await new Response(ghProc.stdout).text();
  const ghErr = await new Response(ghProc.stderr).text();
  await ghProc.exited;

  if (ghProc.exitCode !== 0) {
    return { error: ghErr.trim() || "No pull request found for this branch." };
  }

  // 4. Parse the JSON response
  try {
    const parsed = JSON.parse(ghOut);
    if (typeof parsed.url === "string") {
      return { url: parsed.url };
    }
    return { error: "Could not parse PR URL from GitHub CLI output." };
  } catch {
    return { error: "Could not parse PR URL from GitHub CLI output." };
  }
}
