import { createHash } from "node:crypto";
import type { DiffStats, TempestWorkspace } from "../../shared/ipc-types";
import { VCSType, WorkspaceStatus } from "../../shared/ipc-types";
import type { VCSProvider } from "./types";
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

  async listWorkspaceNames(): Promise<string[]> {
    const output = await this.runGit(
      ["worktree", "list", "--porcelain"],
      this.repoPath,
    );
    return parseWorktreeList(output);
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
 * Parse `git worktree list --porcelain` output into workspace names.
 * First block = main worktree ("default").
 * Subsequent: branch name from `branch refs/heads/<name>`, or last path component if detached.
 */
export function parseWorktreeList(output: string): string[] {
  const blocks = output
    .split("\n\n")
    .filter((b) => b.trim().length > 0);
  const names: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (i === 0) {
      names.push("default");
      continue;
    }
    const lines = block.split("\n");
    const branchLine = lines.find((l) => l.startsWith("branch refs/heads/"));
    if (branchLine) {
      names.push(branchLine.slice("branch refs/heads/".length));
    } else {
      const worktreeLine = lines.find((l) => l.startsWith("worktree "));
      if (worktreeLine) {
        const path = worktreeLine.slice("worktree ".length);
        const lastComponent = path.split("/").pop() ?? path;
        names.push(lastComponent);
      }
    }
  }
  return names;
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
