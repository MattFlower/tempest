// ============================================================
// Diff provider — fetches raw unified diff from VCS.
// Uses the same PathResolver pattern as git-provider.ts and jj-provider.ts.
// ============================================================

import { DiffScope, VCSType } from "../../shared/ipc-types";
import { PathResolver } from "../config/path-resolver";
import { detectVCSType } from "../vcs/detector";
import { loadConfig } from "../config/app-config";

const pathResolver = new PathResolver();

export interface DiffResult {
  raw: string;
  files: import("../../shared/ipc-types").DiffFile[];
}

/**
 * Fetch raw unified diff for a workspace.
 */
export async function getDiff(
  workspacePath: string,
  scope: DiffScope,
  contextLines?: number,
  commitRef?: string,
): Promise<DiffResult> {
  const config = await loadConfig();
  const vcsType = detectVCSType(workspacePath);
  const ctx = contextLines ?? 3;

  let raw: string;
  if (vcsType === VCSType.JJ) {
    raw = await getJJDiff(workspacePath, scope, ctx, config.jjPath, commitRef);
  } else {
    raw = await getGitDiff(workspacePath, scope, ctx, config.gitPath, commitRef);
  }

  // Parse file list from raw diff for the sidebar
  const files = parseFileList(raw);

  return { raw, files };
}

async function getGitDiff(
  workspacePath: string,
  scope: DiffScope,
  contextLines: number,
  configuredPath?: string,
  commitRef?: string,
): Promise<string> {
  const gitPath = pathResolver.resolve("git", configuredPath);

  if (scope === DiffScope.SingleCommit && commitRef) {
    return runCommand(
      [gitPath, "show", `--format=`, `-U${contextLines}`, commitRef],
      workspacePath,
    );
  }

  if (scope === DiffScope.SinceTrunk) {
    // Get merge-base first
    const baseBranch = await detectGitBaseBranch(workspacePath, gitPath);
    const mergeBase = await runCommand(
      [gitPath, "merge-base", "HEAD", baseBranch],
      workspacePath,
    );
    return runCommand(
      [gitPath, "diff", `-U${contextLines}`, mergeBase.trim() + "..HEAD"],
      workspacePath,
    );
  }

  // CurrentChange: working tree changes
  return runCommand(
    [gitPath, "diff", `-U${contextLines}`, "HEAD"],
    workspacePath,
  );
}

async function getJJDiff(
  workspacePath: string,
  scope: DiffScope,
  contextLines: number,
  configuredPath?: string,
  commitRef?: string,
): Promise<string> {
  const jjPath = pathResolver.resolve("jj", configuredPath);

  if (scope === DiffScope.SingleCommit && commitRef) {
    // Translate git-style HEAD to jj's @ (working copy parent)
    const jjRef = commitRef === "HEAD" ? "@" : commitRef;
    return runCommand(
      [jjPath, "diff", "--git", `--context=${contextLines}`, "-r", jjRef],
      workspacePath,
    );
  }

  if (scope === DiffScope.SinceTrunk) {
    return runCommand(
      [jjPath, "diff", "--git", `--context=${contextLines}`, "--from", "trunk()"],
      workspacePath,
    );
  }

  // CurrentChange
  return runCommand(
    [jjPath, "diff", "--git", `--context=${contextLines}`],
    workspacePath,
  );
}

async function detectGitBaseBranch(
  directory: string,
  gitPath: string,
): Promise<string> {
  try {
    await runCommand([gitPath, "rev-parse", "--verify", "main"], directory);
    return "main";
  } catch {
    return "master";
  }
}

async function runCommand(
  args: string[],
  cwd: string,
): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) {
    // For diff commands, exit code 1 means "differences found" — that's OK
    if (proc.exitCode === 1 && stdout.length > 0) {
      return stdout;
    }
    throw new Error(
      `${args[0]} ${args.slice(1).join(" ")} failed (exit ${proc.exitCode}): ${stderr}`,
    );
  }
  return stdout;
}

/**
 * Extract file list from raw unified diff.
 * Quick parse — just extracts paths and statuses from diff headers.
 */
function parseFileList(
  raw: string,
): import("../../shared/ipc-types").DiffFile[] {
  const files: import("../../shared/ipc-types").DiffFile[] = [];
  const lines = raw.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith("diff --git ")) {
      i++;
      continue;
    }

    // Extract paths
    const stripped = line.replace("diff --git ", "");
    const parts = stripped.split(" b/");
    if (parts.length < 2) {
      i++;
      continue;
    }

    const oldPath = parts[0]!.startsWith("a/") ? parts[0]!.slice(2) : parts[0]!;
    const newPath = parts.slice(1).join(" b/");
    let status: "modified" | "added" | "deleted" | "renamed" = "modified";

    // Scan header lines for status markers
    i++;
    while (i < lines.length && !lines[i]!.startsWith("diff --git ")) {
      const headerLine = lines[i]!;
      if (headerLine.startsWith("new file mode")) {
        status = "added";
      } else if (headerLine.startsWith("deleted file mode")) {
        status = "deleted";
      } else if (headerLine.startsWith("rename from ")) {
        status = "renamed";
      } else if (headerLine.startsWith("@@")) {
        break;
      }
      i++;
    }

    files.push({ oldPath, newPath, status });

    // Skip to next diff --git or end (don't increment — while loop will handle)
    while (i < lines.length && !lines[i]!.startsWith("diff --git ")) {
      i++;
    }
  }

  return files;
}
