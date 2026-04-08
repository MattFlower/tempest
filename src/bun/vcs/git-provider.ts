import { createHash } from "node:crypto";
import type { DiffStats, TempestWorkspace } from "../../shared/ipc-types";
import { BranchHealthStatus, VCSType, WorkspaceStatus } from "../../shared/ipc-types";
import type { VCSProvider, WorkspaceEntry } from "./types";
import { PathResolver } from "../config/path-resolver";

export class GitProvider implements VCSProvider {
  readonly vcsType = VCSType.Git;
  readonly repoPath: string;
  private readonly pathResolver = new PathResolver();
  private readonly configuredGitPath?: string;

  constructor(repoPath: string, configuredGitPath?: string) {
    this.repoPath = repoPath;
    this.configuredGitPath = configuredGitPath;
  }

  async createWorkspace(
    name: string,
    atPath: string,
    branch?: string,
    useExistingBranch?: boolean,
  ): Promise<TempestWorkspace> {
    const branchName = branch ?? name;
    if (useExistingBranch) {
      await this.runGit(["worktree", "add", atPath, branchName], this.repoPath);
    } else {
      await this.runGit(
        ["worktree", "add", atPath, "-b", branchName],
        this.repoPath,
      );
    }
    return {
      id: createHash("sha256").update(atPath).digest("hex").slice(0, 16),
      name,
      path: atPath,
      repoPath: this.repoPath,
      status: WorkspaceStatus.Idle,
    };
  }

  async listWorkspaces(_wsRoot: string): Promise<WorkspaceEntry[]> {
    const output = await this.runGit(
      ["worktree", "list", "--porcelain"],
      this.repoPath,
    );
    return parseWorktreeList(output);
  }

  async renameWorkspace(
    workspace: TempestWorkspace,
    _newName: string,
    newPath: string,
  ): Promise<void> {
    await this.runGit(
      ["worktree", "move", workspace.path, newPath],
      this.repoPath,
    );
  }

  async archiveWorkspace(workspace: TempestWorkspace): Promise<void> {
    if (workspace.path === this.repoPath) {
      throw new Error("Cannot archive main worktree");
    }
    await this.runGit(
      ["worktree", "remove", "--force", workspace.path],
      this.repoPath,
    );
  }

  async bookmarkName(workspace: TempestWorkspace): Promise<string | undefined> {
    const output = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      workspace.path,
    );
    const trimmed = output.trim();
    return trimmed === "HEAD" ? undefined : trimmed;
  }

  async listBranches(): Promise<string[]> {
    // Get all local and remote branch names
    const output = await this.runGit(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads/", "refs/remotes/"],
      this.repoPath,
    );

    // Get branches already checked out in worktrees so we can exclude them
    const worktreeOutput = await this.runGit(
      ["worktree", "list", "--porcelain"],
      this.repoPath,
    );
    const worktreeNames = new Set(parseWorktreeList(worktreeOutput).map((e) => e.name));

    const seen = new Set<string>();
    const branches: string[] = [];

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip HEAD pointers like origin/HEAD
      if (trimmed.endsWith("/HEAD")) continue;

      // Normalize remote branches: strip origin/ prefix
      const name = trimmed.startsWith("origin/")
        ? trimmed.slice("origin/".length)
        : trimmed;

      if (!name || seen.has(name) || worktreeNames.has(name)) continue;
      seen.add(name);
      branches.push(name);
    }

    branches.sort((a, b) => a.localeCompare(b));
    return branches;
  }

  async branchHealth(workspace: TempestWorkspace): Promise<BranchHealthStatus | undefined> {
    try {
      // Check for conflicts first (highest priority)
      const unmerged = await this.runGit(["ls-files", "--unmerged"], workspace.path);
      if (unmerged.trim()) return BranchHealthStatus.HasConflicts;

      // Check if main/master is an ancestor of HEAD
      const baseBranch = await this.detectBaseBranch(workspace.path);
      try {
        await this.runGit(["merge-base", "--is-ancestor", baseBranch, "HEAD"], workspace.path);
        return BranchHealthStatus.Ok;
      } catch {
        // Exit code 1 = baseBranch is NOT an ancestor of HEAD = needs rebase
        return BranchHealthStatus.NeedsRebase;
      }
    } catch {
      return undefined;
    }
  }

  async diffStats(workspace: TempestWorkspace): Promise<DiffStats> {
    const baseBranch = await this.detectBaseBranch(workspace.path);
    const output = await this.runGit(
      ["diff", "--stat", baseBranch],
      workspace.path,
    );
    return parseDiffStatSummary(output);
  }

  private async detectBaseBranch(directory: string): Promise<string> {
    try {
      await this.runGit(["rev-parse", "--verify", "main"], directory);
      return "main";
    } catch {
      return "master";
    }
  }

  private async runGit(args: string[], directory: string): Promise<string> {
    const gitPath = this.pathResolver.resolve("git", this.configuredGitPath);
    const proc = Bun.spawn([gitPath, ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed (exit ${proc.exitCode}): ${stderr}`,
      );
    }
    return stdout;
  }
}

/**
 * Parse `git worktree list --porcelain` output into workspace entries.
 * First block = main worktree ("default") with its actual path.
 * Subsequent: workspace name is the last path component of the worktree directory,
 * keeping workspace names independent of branch names.
 */
export function parseWorktreeList(output: string): WorkspaceEntry[] {
  const blocks = output
    .split("\n\n")
    .filter((b) => b.trim().length > 0);
  const entries: WorkspaceEntry[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const lines = block.split("\n");
    const worktreeLine = lines.find((l) => l.startsWith("worktree "));
    const path = worktreeLine ? worktreeLine.slice("worktree ".length) : "";

    if (i === 0) {
      entries.push({ name: "default", path });
      continue;
    }

    if (path) {
      entries.push({
        name: path.split("/").pop() ?? path,
        path,
      });
    }
  }
  return entries;
}

export function parseDiffStatSummary(output: string): DiffStats {
  const lines = output.trim().split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  let additions = 0;
  let deletions = 0;
  let filesChanged = 0;

  const insertMatch = lastLine.match(/(\d+) insertion/);
  if (insertMatch?.[1]) additions = parseInt(insertMatch[1], 10);

  const deleteMatch = lastLine.match(/(\d+) deletion/);
  if (deleteMatch?.[1]) deletions = parseInt(deleteMatch[1], 10);

  const filesMatch = lastLine.match(/(\d+) file/);
  if (filesMatch?.[1]) filesChanged = parseInt(filesMatch[1], 10);

  return { additions, deletions, filesChanged };
}
