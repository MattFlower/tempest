import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtyManager } from "./pty-manager";

interface SpawnCall {
  proc: any;
  onExit?: (proc: any, exitCode: number | null) => void;
}

function makeFakeProc(pid: number) {
  const write = mock(() => {});
  const resize = mock(() => {});
  const close = mock(() => {});
  const kill = mock(() => {});

  return {
    pid,
    terminal: { write, resize, close },
    kill,
  };
}

describe("PtyManager", () => {
  let originalSpawn: typeof Bun.spawn;
  let tempDir: string;
  let manager: PtyManager;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
    tempDir = mkdtempSync(join(tmpdir(), "pty-manager-test-"));
    manager = new PtyManager();
  });

  afterEach(() => {
    manager.killAll();
    (Bun as any).spawn = originalSpawn;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("ignores stale onExit callbacks from an old process after terminal id reuse", () => {
    const spawnCalls: SpawnCall[] = [];

    let pid = 1000;
    (Bun as any).spawn = mock((_cmd: string[], options: any) => {
      const proc = makeFakeProc(pid++);
      spawnCalls.push({ proc, onExit: options?.onExit });
      return proc;
    });

    const exits: Array<{ id: string; code: number }> = [];
    manager.onExit((id, code) => exits.push({ id, code }));

    const firstCreate = manager.create({
      id: "term-1",
      command: ["/bin/zsh", "-l"],
      cwd: tempDir,
      cols: 80,
      rows: 24,
    });
    expect(firstCreate.success).toBeTrue();
    expect(manager.isRunning("term-1")).toBeTrue();

    manager.kill("term-1");
    manager.kill("term-1"); // idempotent while terminating

    expect(spawnCalls[0]!.proc.terminal.close).toHaveBeenCalledTimes(1);
    expect(spawnCalls[0]!.proc.kill).toHaveBeenCalledTimes(1);
    expect(manager.isRunning("term-1")).toBeTrue();

    const createWhileTerminating = manager.create({
      id: "term-1",
      command: ["/bin/zsh", "-l"],
      cwd: tempDir,
      cols: 80,
      rows: 24,
    });
    expect(createWhileTerminating.success).toBeFalse();
    expect(createWhileTerminating.error).toContain("shutting down");

    // Real exit for first process
    spawnCalls[0]!.onExit?.(spawnCalls[0]!.proc, 0);
    expect(manager.isRunning("term-1")).toBeFalse();
    expect(exits).toEqual([{ id: "term-1", code: 0 }]);

    const secondCreate = manager.create({
      id: "term-1",
      command: ["/bin/zsh", "-l"],
      cwd: tempDir,
      cols: 80,
      rows: 24,
    });
    expect(secondCreate.success).toBeTrue();
    expect(manager.isRunning("term-1")).toBeTrue();

    // Stale duplicate callback from old process must be ignored.
    spawnCalls[0]!.onExit?.(spawnCalls[0]!.proc, 99);
    expect(manager.isRunning("term-1")).toBeTrue();
    expect(exits).toEqual([{ id: "term-1", code: 0 }]);

    // Current process exit should still be delivered.
    spawnCalls[1]!.onExit?.(spawnCalls[1]!.proc, 12);
    expect(manager.isRunning("term-1")).toBeFalse();
    expect(exits).toEqual([
      { id: "term-1", code: 0 },
      { id: "term-1", code: 12 },
    ]);
  });

  test("cleans preallocated state when spawn throws during create", () => {
    (Bun as any).spawn = mock(() => {
      throw new Error("spawn failed");
    });

    const originalConsoleError = console.error;
    console.error = mock(() => {}) as any;

    try {
      const result = manager.create({
        id: "fail-id",
        command: ["/bin/zsh", "-l"],
        cwd: tempDir,
        cols: 80,
        rows: 24,
      });

      expect(result.success).toBeFalse();
      expect(result.error).toContain("spawn failed");

      // White-box: verify no leaked internal state after failed spawn.
      const internal = manager as any;
      expect(internal.seqCounters.has("fail-id")).toBeFalse();
    } finally {
      console.error = originalConsoleError;
    }

    const proc = makeFakeProc(2000);
    const successfulSpawn = mock((_cmd: string[]) => {
      return proc;
    });
    (Bun as any).spawn = successfulSpawn;

    const retry = manager.create({
      id: "fail-id",
      command: ["/bin/zsh", "-l"],
      cwd: tempDir,
      cols: 80,
      rows: 24,
    });

    expect(retry.success).toBeTrue();
    expect(manager.isRunning("fail-id")).toBeTrue();
  });
});
