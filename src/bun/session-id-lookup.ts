import { readdirSync, readFileSync, existsSync } from "node:fs";
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

/**
 * Given a session ID and workspace path, find the Claude Code plan file
 * associated with that session.
 *
 * Strategy:
 * 1. Derive the encoded project directory from the workspace path
 * 2. Find the transcript JSONL at ~/.claude/projects/{encoded}/{sessionId}.jsonl
 * 3. Extract the "slug" field from the transcript (appears after first few lines)
 * 4. Check if ~/.claude/plans/{slug}.md exists
 */
export function lookupPlanPath(
  sessionId: string,
  workspacePath: string,
  claudeDir?: string,
): string | null {
  const base = claudeDir ?? join(homedir(), ".claude");
  const plansDir = join(base, "plans");

  // Encode the workspace path the same way Claude Code does: replace / with -
  const encodedPath = workspacePath.replace(/\//g, "-");
  const transcriptPath = join(base, "projects", encodedPath, `${sessionId}.jsonl`);

  const slug = extractSlugFromTranscript(transcriptPath);
  if (!slug) return null;

  const planPath = join(plansDir, `${slug}.md`);
  if (existsSync(planPath)) return planPath;

  return null;
}

/**
 * Extract the slug field from a JSONL transcript file.
 * The slug doesn't appear on every line — scan until we find one.
 */
function extractSlugFromTranscript(transcriptPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  // Scan lines for a "slug" field. It typically appears after the first few lines.
  // Read up to 100 lines to keep this fast.
  const lines = content.split("\n");
  const limit = Math.min(lines.length, 100);
  for (let i = 0; i < limit; i++) {
    const match = lines[i]!.match(/"slug":"([a-z]+-[a-z]+-[a-z]+(?:-[a-z]+)*)"/);
    if (match?.[1]) return match[1];
  }

  return null;
}
