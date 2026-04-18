import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DiffStats, TempestWorkspace } from "../../shared/ipc-types";
import { BranchHealthStatus, VCSType, WorkspaceStatus } from "../../shared/ipc-types";
import type { VCSProvider, WorkspaceEntry } from "./types";
import { PathResolver } from "../config/path-resolver";
import { parseDiffStatSummary } from "./shared";

export class JJProvider implements VCSProvider {
  readonly vcsType = VCSType.JJ;
  readonly repoPath: string;
  private readonly pathResolver = new PathResolver();
  private readonly configuredJJPath?: string;

  constructor(repoPath: string, configuredJJPath?: string) {
    this.repoPath = repoPath;
    this.configuredJJPath = configuredJJPath;
  }

  async createWorkspace(
    name: string,
    atPath: string,
    branch?: string,
    useExistingBranch?: boolean,
  ): Promise<TempestWorkspace> {
    await this.runJJ(
      ["workspace", "add", atPath, "--name", name],
      this.repoPath,
    );
    if (useExistingBranch && branch) {
      await this.runJJ(["git", "import"], atPath);
      await this.runJJ(["new", branch], atPath);
    }
    return {
      id: createHash("sha256").update(atPath).digest("hex").slice(0, 16),
      name,
      path: atPath,
      repoPath: this.repoPath,
      status: WorkspaceStatus.Idle,
    };
  }

  async listWorkspaces(wsRoot: string): Promise<WorkspaceEntry[]> {
    const output = await this.runJJ(["workspace", "list"], this.repoPath);
    // jj workspace list output format: `name: <change-id> <description>`.
    // Names containing spaces or other special characters are wrapped in double
    // quotes, e.g. `"workspace with space": <change-id> ...`.
    const names = output
      .split("\n")
      .map((line) => parseWorkspaceName(line))
      .filter((name) => name.length > 0);

    return names.map((name) => ({
      name: name === "default" ? "default" : name,
      path: name === "default" ? this.repoPath : join(wsRoot, name),
    }));
  }

  async renameWorkspace(
    workspace: TempestWorkspace,
    newName: string,
    newPath: string,
  ): Promise<void> {
    await this.runJJ(
      ["workspace", "rename", newName],
      workspace.path,
    );
    if (workspace.path !== newPath) {
      const { rename } = await import("node:fs/promises");
      await rename(workspace.path, newPath);
    }
  }

  async archiveWorkspace(workspace: TempestWorkspace): Promise<void> {
    await this.runJJ(["workspace", "forget", workspace.name], this.repoPath);
    if (existsSync(workspace.path)) {
      await rm(workspace.path, { recursive: true, force: true });
    }
  }

  async bookmarkName(
    workspace: TempestWorkspace,
  ): Promise<string | undefined> {
    const output = await this.runJJ(
      ["log", "-r", "@", "--no-graph", "-T", "bookmarks"],
      workspace.path,
    );
    const trimmed = output.trim();
    if (!trimmed) return undefined;
    // May contain multiple bookmarks separated by spaces; return the first
    return trimmed.split(/\s+/)[0];
  }

  async listBranches(): Promise<string[]> {
    const output = await this.runJJ(
      ["bookmark", "list", "--template", 'name ++ "\\n"'],
      this.repoPath,
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  async branchHealth(workspace: TempestWorkspace): Promise<BranchHealthStatus | undefined> {
    try {
      // Check for conflicts first (highest priority)
      const conflictOutput = await this.runJJ(
        ["log", "-r", "@", "--no-graph", "-T", 'if(conflict, "true", "false")'],
        workspace.path,
      );
      if (conflictOutput.trim() === "true") return BranchHealthStatus.HasConflicts;

      // Check if trunk is an ancestor of @ (empty = trunk NOT ancestor = needs rebase)
      const ancestorOutput = await this.runJJ(
        ["log", "-r", "trunk() & ::@", "--no-graph", "-T", "change_id.short(8)"],
        workspace.path,
      );
      if (ancestorOutput.trim() === "") return BranchHealthStatus.NeedsRebase;

      return BranchHealthStatus.Ok;
    } catch {
      return undefined;
    }
  }

  async diffStats(workspace: TempestWorkspace): Promise<DiffStats> {
    const output = await this.runJJ(
      ["diff", "--stat", "--from", "roots(trunk()..@)-"],
      workspace.path,
    );
    return parseDiffStatSummary(output);
  }

  private async runJJ(args: string[], directory: string): Promise<string> {
    const jjPath = this.pathResolver.resolve("jj", this.configuredJJPath);
    const proc = Bun.spawn([jjPath, ...args], {
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
        `jj ${args.join(" ")} failed (exit ${proc.exitCode}): ${stderr}`,
      );
    }
    return stdout;
  }
}

/**
 * Extract a workspace name from a single line of `jj workspace list` output.
 * jj wraps names containing whitespace or other special characters in double
 * quotes and backslash-escapes embedded quotes/backslashes.
 */
function parseWorkspaceName(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('"')) {
    let i = 1;
    let name = "";
    while (i < trimmed.length) {
      const ch = trimmed[i];
      if (ch === "\\" && i + 1 < trimmed.length) {
        name += trimmed[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') return name;
      name += ch;
      i++;
    }
    return "";
  }
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return "";
  return trimmed.slice(0, colonIdx).trim();
}
