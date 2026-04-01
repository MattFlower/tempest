// ============================================================
// Git commit operations — staging, committing, pushing, status.
// Used by the VCS View frontend.
// ============================================================

import { PathResolver } from "../config/path-resolver";
import { loadConfig } from "../config/app-config";
import type {
  VCSFileEntry,
  VCSFileChangeType,
  VCSStatusResult,
  VCSCommitResult,
  VCSFileDiffResult,
} from "../../shared/ipc-types";

const pathResolver = new PathResolver();

async function getGitPath(): Promise<string> {
  const config = await loadConfig();
  return pathResolver.resolve("git", config.gitPath);
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const gitPath = await getGitPath();
  const proc = Bun.spawn([gitPath, ...args], {
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

// --- Language detection from file extension ---

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  lua: "lua",
  vim: "vim",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";
  return LANG_MAP[ext] ?? "plaintext";
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
    ["status", "--porcelain=v2", "--branch"],
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

  try {
    if (staged) {
      // Staged: original = HEAD, modified = index
      try {
        originalContent = await runGitOrThrow(
          ["show", `HEAD:${filePath}`],
          workspacePath,
        );
      } catch {
        // New file — no HEAD version
        originalContent = "";
      }
      try {
        modifiedContent = await runGitOrThrow(
          ["show", `:${filePath}`],
          workspacePath,
        );
      } catch {
        // Deleted from index
        modifiedContent = "";
      }
    } else {
      // Unstaged: original = index (or HEAD if not staged), modified = working tree
      try {
        // Try index first, fall back to HEAD
        modifiedContent = await Bun.file(`${workspacePath}/${filePath}`).text();
      } catch {
        modifiedContent = "";
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
          originalContent = "";
        }
      }
    }
  } catch {
    // Fallback: return empty strings
  }

  return { originalContent, modifiedContent, filePath, language };
}
