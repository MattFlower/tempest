// ============================================================
// FindInFilesSearcher — shells out to ripgrep (`rg --json`)
// to search the contents of a workspace directory and returns
// line-level match records suitable for a UI result list.
// ============================================================

import { existsSync } from "node:fs";
import type { FindInFilesMatch, FindInFilesResult } from "../../shared/ipc-types";
import { PathResolver } from "../config/path-resolver";

const IGNORE_DIRS = [
  "node_modules", ".git", ".jj", "dist", "build", ".next",
  ".cache", ".turbo", "coverage", "__pycache__", ".venv",
  "target", ".idea", ".vscode",
];

export class FindInFilesSearcher {
  private rgPath: string | null = null;

  constructor() {
    try {
      this.rgPath = new PathResolver().resolve("rg");
    } catch {
      this.rgPath = null;
    }
  }

  get isAvailable(): boolean {
    return this.rgPath !== null;
  }

  async search(opts: {
    workspacePath: string;
    query: string;
    isRegex: boolean;
    caseSensitive: boolean;
    maxResults: number;
  }): Promise<FindInFilesResult> {
    const query = opts.query.trim();
    if (!query) return { matches: [], truncated: false };

    if (!this.rgPath) {
      return { matches: [], truncated: false, error: "ripgrep not found in PATH" };
    }

    if (!opts.workspacePath || !existsSync(opts.workspacePath)) {
      return { matches: [], truncated: false, error: "Workspace path not found" };
    }

    const args: string[] = [this.rgPath, "--json", "--hidden", "--max-count", "50"];
    if (!opts.isRegex) args.push("-F");
    if (!opts.caseSensitive) args.push("-i");
    for (const dir of IGNORE_DIRS) {
      args.push("--glob", `!${dir}`);
    }
    args.push("--", opts.query, opts.workspacePath);

    try {
      const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      if (stderr && /regex parse error/i.test(stderr)) {
        const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "Invalid regex";
        return { matches: [], truncated: false, error: `Invalid regex: ${firstLine.trim()}` };
      }

      return parseFindInFilesMatches(stdout, opts.maxResults);
    } catch (e: any) {
      return { matches: [], truncated: false, error: e?.message ?? "Search failed" };
    }
  }
}

export function parseFindInFilesMatches(
  output: string,
  maxResults: number,
): FindInFilesResult {
  const matches: FindInFilesMatch[] = [];
  let truncated = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let json: any;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (json.type !== "match" || !json.data) continue;
    const data = json.data;

    const filePath: string | undefined = data.path?.text;
    const lineNumber: number | undefined = data.line_number;
    const lineText: string | undefined = data.lines?.text;
    if (!filePath || typeof lineNumber !== "number" || typeof lineText !== "string") continue;

    if (matches.length >= maxResults) {
      truncated = true;
      continue;
    }

    const submatches = Array.isArray(data.submatches)
      ? data.submatches
          .filter((s: any) => typeof s?.start === "number" && typeof s?.end === "number")
          .map((s: any) => ({ start: s.start, end: s.end }))
      : [];

    matches.push({
      filePath,
      lineNumber,
      lineText: lineText.replace(/\r?\n$/, ""),
      submatches,
    });
  }

  return { matches, truncated };
}
