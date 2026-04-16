import type { DiffStats } from "../../shared/ipc-types";

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

export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";
  return LANG_MAP[ext] ?? "plaintext";
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

/**
 * Detect main/master as the base branch in a git repo.
 * Accepts a runGit callback so both GitProvider and git-commit-provider can use it.
 */
export async function detectBaseBranch(
  directory: string,
  runGit: (args: string[], cwd: string) => Promise<string>,
): Promise<string> {
  try {
    await runGit(["rev-parse", "--verify", "main"], directory);
    return "main";
  } catch {
    return "master";
  }
}
