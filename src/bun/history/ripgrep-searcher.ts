// ============================================================
// Ripgrep Searcher — Port of RipgrepSearcher.swift
// Shells out to `rg` (ripgrep) for full-text search across
// Claude Code JSONL session files.
// ============================================================

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PathResolver } from "../config/path-resolver";

export class RipgrepSearcher {
  private readonly claudeDir: string;
  private rgPath: string | null = null;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? join(homedir(), ".claude");
    try {
      const resolver = new PathResolver();
      this.rgPath = resolver.resolve("rg");
    } catch {
      this.rgPath = null;
    }
  }

  get isAvailable(): boolean {
    return this.rgPath !== null;
  }

  /**
   * Search JSONL files for the given query.
   * Returns unique file paths that contain matches.
   */
  async search(
    query: string,
    scope: "all" | "project",
    projectPath?: string,
  ): Promise<string[]> {
    if (!this.rgPath) return [];
    if (scope === "project" && !projectPath) return [];

    let searchPath: string;
    if (scope === "project") {
      searchPath = join(this.claudeDir, "projects", projectPath!);
    } else {
      searchPath = join(this.claudeDir, "projects");
    }

    if (!existsSync(searchPath)) return [];

    try {
      const proc = Bun.spawn(
        [
          this.rgPath,
          "--json",
          "-i",
          "--max-count",
          "3",
          "--glob",
          "*.jsonl",
          "--",
          query,
          searchPath,
        ],
        {
          stdout: "pipe",
          stderr: "ignore",
        },
      );

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      return parseRipgrepJSON(stdout);
    } catch {
      return [];
    }
  }
}

/**
 * Parse ripgrep JSON output and extract unique file paths from match lines.
 */
export function parseRipgrepJSON(output: string): string[] {
  const paths = new Set<string>();
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const json = JSON.parse(trimmed);
      if (
        json.type === "match" &&
        json.data?.path?.text &&
        typeof json.data.path.text === "string"
      ) {
        paths.add(json.data.path.text);
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  return Array.from(paths).sort();
}
