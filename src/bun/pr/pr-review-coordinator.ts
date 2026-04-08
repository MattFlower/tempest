// ============================================================
// PR Review Coordinator — Fetches PR metadata, fetches the branch,
// creates a workspace on that branch. Port of PRReviewCoordinator.swift.
// ============================================================

import { PathResolver } from "../config/path-resolver";
import { parseGitHubRemote } from "./pr-url-lookup";
import type { WorkspaceManager } from "../workspace-manager";
import type { TempestWorkspace } from "../../shared/ipc-types";

const pathResolver = new PathResolver();

interface GitHubPRInfo {
  number: number;
  title: string;
  headRefName: string;
  url: string;
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = "pr-";
  // Workspace name will be "pr-{number}-{slug}", but we compute the slug part
  // and truncate so the full name stays under 50 chars.
  return slug;
}

function prWorkspaceName(number: number, title: string): string {
  const prefix = `pr-${number}-`;
  const maxSlugLen = 50 - prefix.length;
  let slug = slugifyTitle(title);
  if (slug.length > maxSlugLen) {
    slug = slug.slice(0, maxSlugLen).replace(/-+$/, "");
  }
  return prefix + slug;
}

export interface PRReviewResult {
  success: boolean;
  error?: string;
  workspace?: TempestWorkspace;
  prUrl?: string;
}

export async function startPRReview(
  workspaceManager: WorkspaceManager,
  repoId: string,
  prNumber: number,
): Promise<PRReviewResult> {
  const repos = workspaceManager.getRepos();
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) {
    return { success: false, error: "Repository not found" };
  }

  // Check for existing PR workspace — still run prepare script in case
  // it was skipped or failed on the original creation.
  const existing = workspaceManager.getWorkspaces(repoId);
  const existingPR = existing.find((ws) => ws.name.startsWith(`pr-${prNumber}-`));
  if (existingPR) {
    const prUrl = await fetchPRUrl(prNumber, repo.path);
    const prepareError = await runPrepareIfConfigured(workspaceManager, repo.path, existingPR.path);
    return { success: true, workspace: existingPR, prUrl, error: prepareError };
  }

  // 1. Get remote URL
  let gitPath: string;
  try {
    gitPath = pathResolver.resolve("git");
  } catch {
    return { success: false, error: "git not found" };
  }

  const remoteProc = Bun.spawn([gitPath, "remote", "get-url", "origin"], {
    cwd: repo.path,
    stdout: "pipe",
    stderr: "pipe",
  });
  const remoteOut = await new Response(remoteProc.stdout).text();
  const remoteErr = await new Response(remoteProc.stderr).text();
  await remoteProc.exited;

  if (remoteProc.exitCode !== 0) {
    return { success: false, error: `Could not get git remote: ${remoteErr.trim()}` };
  }

  // 2. Parse owner/repo
  const ownerRepo = parseGitHubRemote(remoteOut);
  if (!ownerRepo) {
    return { success: false, error: `Could not parse GitHub remote from '${remoteOut.trim()}'` };
  }

  // 3. Fetch PR metadata via gh CLI
  let ghPath: string;
  try {
    ghPath = pathResolver.resolve("gh");
  } catch {
    return { success: false, error: "gh CLI not found. Install it with: brew install gh" };
  }

  const ghProc = Bun.spawn(
    [ghPath, "pr", "view", String(prNumber), "--repo", ownerRepo, "--json", "title,headRefName,url"],
    { cwd: repo.path, stdout: "pipe", stderr: "pipe" },
  );
  const ghOut = await new Response(ghProc.stdout).text();
  const ghErr = await new Response(ghProc.stderr).text();
  await ghProc.exited;

  if (ghProc.exitCode !== 0) {
    return { success: false, error: ghErr.trim() || `No pull request #${prNumber} found.` };
  }

  let prInfo: GitHubPRInfo;
  try {
    const parsed = JSON.parse(ghOut);
    prInfo = {
      number: prNumber,
      title: parsed.title,
      headRefName: parsed.headRefName,
      url: parsed.url,
    };
  } catch {
    return { success: false, error: "Could not parse PR metadata from GitHub CLI output." };
  }

  // 4. Fetch the remote branch
  const fetchProc = Bun.spawn([gitPath, "fetch", "origin", prInfo.headRefName], {
    cwd: repo.path,
    stdout: "pipe",
    stderr: "pipe",
  });
  await fetchProc.exited;

  if (fetchProc.exitCode !== 0) {
    const fetchErr = await new Response(fetchProc.stderr).text();
    return { success: false, error: `Failed to fetch branch '${prInfo.headRefName}': ${fetchErr.trim()}` };
  }

  // 5. Create workspace (runs prepare script via createWorkspace)
  const wsName = prWorkspaceName(prNumber, prInfo.title);
  const result = await workspaceManager.createWorkspace(
    repoId,
    wsName,
    prInfo.headRefName,
    true, // useExistingBranch
  );

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to create workspace." };
  }

  return {
    success: true,
    workspace: result.workspace,
    prUrl: prInfo.url,
    error: result.error, // propagate prepare-script errors
  };
}

/**
 * Run the repo's prepare script in the given workspace directory.
 * Returns an error string if the script fails, undefined otherwise.
 */
async function runPrepareIfConfigured(
  workspaceManager: WorkspaceManager,
  repoPath: string,
  workspacePath: string,
): Promise<string | undefined> {
  const settings = workspaceManager.getRepoSettings(repoPath);
  if (!settings?.prepareScript?.trim()) return undefined;

  const result = await workspaceManager.runPrepareScript(settings.prepareScript, workspacePath);
  if (result.exitCode !== 0) {
    console.warn(
      `[pr-review] Prepare script failed (exit ${result.exitCode}):`,
      result.output,
    );
    return `Prepare script failed (exit ${result.exitCode}):\n${result.output}`;
  }
  return undefined;
}

async function fetchPRUrl(prNumber: number, repoPath: string): Promise<string | undefined> {
  try {
    const ghPath = pathResolver.resolve("gh");
    const gitPath = pathResolver.resolve("git");

    const remoteProc = Bun.spawn([gitPath, "remote", "get-url", "origin"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const remoteOut = await new Response(remoteProc.stdout).text();
    await remoteProc.exited;

    const ownerRepo = parseGitHubRemote(remoteOut);
    if (!ownerRepo) return undefined;

    const ghProc = Bun.spawn(
      [ghPath, "pr", "view", String(prNumber), "--repo", ownerRepo, "--json", "url"],
      { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
    );
    const ghOut = await new Response(ghProc.stdout).text();
    await ghProc.exited;

    const parsed = JSON.parse(ghOut);
    return parsed.url;
  } catch {
    return undefined;
  }
}
