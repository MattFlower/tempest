import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Matches Claude Code's PID file structure at ~/.claude/sessions/{PID}.json */
interface ClaudeSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
}

function sessionsDir(claudeDir?: string): string {
  return join(claudeDir ?? join(homedir(), ".claude"), "sessions");
}

/**
 * Look up the Claude Code session ID for a given process ID.
 * Reads `~/.claude/sessions/{pid}.json`.
 */
export async function lookupSessionID(pid: number, claudeDir?: string): Promise<string | null> {
  const pidFile = join(sessionsDir(claudeDir), `${pid}.json`);
  try {
    const file = Bun.file(pidFile);
    if (!(await file.exists())) return null;
    const session = (await file.json()) as ClaudeSessionFile;
    return session.sessionId ?? null;
  } catch {
    return null;
  }
}

/**
 * Scan all active Claude session PID files and return session IDs
 * whose cwd matches the given workspace path.
 */
export function findSessionIDs(workspacePath: string, claudeDir?: string): string[] {
  const dir = sessionsDir(claudeDir);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = readFileSync(join(dir, file), "utf-8");
      const session = JSON.parse(data) as ClaudeSessionFile;
      if (session.cwd === workspacePath) {
        results.push(session.sessionId);
      }
    } catch {
      continue;
    }
  }
  return results;
}
