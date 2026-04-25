// ============================================================
// Tiny Bun.spawn wrapper used by the github-release and toolchain
// installers. Captures stdout+stderr, throws a descriptive error when
// the process exits non-zero so failures surface in the popover log.
// ============================================================

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export async function runProc(argv: string[], opts?: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(argv, {
    cwd: opts?.cwd,
    env: opts?.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    const detail = stderr.trim() || stdout.trim() || "(no output)";
    throw new Error(`${argv[0]} exited with code ${code}: ${detail}`);
  }
  return { stdout, stderr };
}
