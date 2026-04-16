import { existsSync } from "node:fs";
import { join } from "node:path";
import { VCSType } from "../../shared/ipc-types";
import type { AppConfig } from "../../shared/ipc-types";
import type { VCSProvider } from "./types";
import { GitProvider } from "./git-provider";
import { JJProvider } from "./jj-provider";

/**
 * Auto-detect VCS for a repository directory.
 * Checks for .jj first (preferred), then .git.
 */
export function detectVCS(repoPath: string, config: AppConfig): VCSProvider {
  if (existsSync(join(repoPath, ".jj"))) {
    return new JJProvider(repoPath, config.jjPath);
  }
  if (existsSync(join(repoPath, ".git"))) {
    return new GitProvider(repoPath, config.gitPath);
  }
  throw new Error(`Not a repository: ${repoPath}`);
}

export function detectVCSType(repoPath: string): VCSType {
  if (existsSync(join(repoPath, ".jj"))) return VCSType.JJ;
  if (existsSync(join(repoPath, ".git"))) return VCSType.Git;
  throw new Error(`Not a repository: ${repoPath}`);
}
