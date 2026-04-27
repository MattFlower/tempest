// ============================================================
// Spawn helper for "stdin → formatted bytes on stdout" CLIs.
//
// Mirrors the Bun.spawn + setTimeout-kill idiom used by usage-service /
// the VCS providers, but specialized for the format pipeline:
//   - feeds a buffer into stdin and closes it,
//   - captures stdout/stderr in parallel,
//   - races a timeout (default 5s),
//   - returns a structured result the caller can convert to FormatResult.
// ============================================================

import type { FormatResult } from "./provider";

export interface SpawnFormatParams {
  bin: string;
  args: string[];
  cwd?: string;
  /** Buffer text to feed to stdin. Always closed after writing. */
  stdin: string;
  /** Soft kill after this many milliseconds. Default 5000. */
  timeoutMs?: number;
  /** Optional env override; merged on top of process.env. */
  env?: Record<string, string>;
}

export interface SpawnFormatRaw {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function spawnFormatter(params: SpawnFormatParams): Promise<SpawnFormatRaw> {
  const proc = Bun.spawn([params.bin, ...params.args], {
    cwd: params.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: params.env ? { ...process.env, ...params.env } : undefined,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch { /* ignore */ }
  }, params.timeoutMs ?? 5000);

  try {
    proc.stdin.write(params.stdin);
    proc.stdin.end();
  } catch {
    // If the child crashed before consuming stdin, capture stderr below.
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  return { exitCode, stdout, stderr, timedOut };
}

/** Common adapter: turn a SpawnFormatRaw into a FormatResult assuming the
 *  CLI emits the formatted buffer on stdout for exit 0. Most formatters
 *  follow this pattern; the few that don't (e.g. shfmt with non-default
 *  flags) can call spawnFormatter directly. */
export function spawnRawToFormatResult(
  raw: SpawnFormatRaw,
  toolName: string,
  originalContent: string,
): FormatResult {
  if (raw.timedOut) {
    return { kind: "error", message: `${toolName} timed out` };
  }
  if (raw.exitCode !== 0) {
    const detail = raw.stderr.trim().split("\n")[0] ?? `exit ${raw.exitCode}`;
    return { kind: "error", message: `${toolName} failed: ${detail}` };
  }
  if (raw.stdout === originalContent) {
    return { kind: "noop" };
  }
  return { kind: "fullText", newText: raw.stdout };
}
