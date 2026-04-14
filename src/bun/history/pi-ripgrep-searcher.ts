// ============================================================
// Pi Ripgrep Searcher
//
// Full-text search over Pi `.jsonl` session files using ripgrep.
// Mirrors RipgrepSearcher but targets `~/.pi/agent/sessions/`.
// ============================================================

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PathResolver } from "../config/path-resolver";
import { parseRipgrepJSON } from "./ripgrep-searcher";

export class PiRipgrepSearcher {
  private readonly sessionsDir: string;
  private rgPath: string | null = null;

  constructor(sessionsDir?: string) {
    this.sessionsDir =
      sessionsDir ?? join(homedir(), ".pi", "agent", "sessions");
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

  async search(
    query: string,
    scope: "all" | "project",
    projectDirs?: string[],
  ): Promise<string[]> {
    if (!this.rgPath) return [];

    const searchPaths: string[] = [];
    if (scope === "project") {
      if (!projectDirs || projectDirs.length === 0) return [];
      for (const dir of projectDirs) {
        searchPaths.push(join(this.sessionsDir, dir));
      }
    } else {
      searchPaths.push(this.sessionsDir);
    }

    const existing = searchPaths.filter((p) => existsSync(p));
    if (existing.length === 0) return [];

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
          query,
          ...existing,
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
