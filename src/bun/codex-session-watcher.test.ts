import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodexSessionWatcher } from "./codex-session-watcher";

let root: string;

beforeEach(() => {
  root = join("/tmp", `tempest-codex-watcher-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRollout(rel: string, meta: object): string {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(meta) + "\n");
  return path;
}

describe("CodexSessionWatcher", () => {
  it("seeds lookupLatestByCwd from existing rollouts when start() runs", () => {
    writeRollout(
      "2026/03/01/rollout-1740787200-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
      {
        type: "session_meta",
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        cwd: "/tmp/ws-seed",
        timestamp: "2026-03-01T00:00:00Z",
      },
    );

    const watcher = new CodexSessionWatcher(root);
    try {
      // We pass a no-op discovery handler; we only care about the seed.
      watcher.start(() => {});
      expect(watcher.lookupLatestByCwd("/tmp/ws-seed")).toBe(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
    } finally {
      watcher.stop();
    }
  });

  it("falls back to the filename uuid when the header lacks an id", () => {
    writeRollout(
      "2026/03/02/rollout-1740873600-11111111-2222-3333-4444-555555555555.jsonl",
      { type: "session_meta", cwd: "/tmp/ws-fallback" },
    );

    const watcher = new CodexSessionWatcher(root);
    try {
      watcher.start(() => {});
      expect(watcher.lookupLatestByCwd("/tmp/ws-fallback")).toBe(
        "11111111-2222-3333-4444-555555555555",
      );
    } finally {
      watcher.stop();
    }
  });

  it("picks the newest rollout per cwd when multiple exist for the same workspace", () => {
    const olderPath = writeRollout(
      "2026/03/01/rollout-1000000000-aaaaaaaa-0000-0000-0000-000000000001.jsonl",
      {
        type: "session_meta",
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        cwd: "/tmp/ws-dupe",
      },
    );
    const newerPath = writeRollout(
      "2026/03/01/rollout-1000000001-aaaaaaaa-0000-0000-0000-000000000002.jsonl",
      {
        type: "session_meta",
        id: "aaaaaaaa-0000-0000-0000-000000000002",
        cwd: "/tmp/ws-dupe",
      },
    );
    // Ensure the second file's mtime is unambiguously later.
    const now = Date.now();
    require("node:fs").utimesSync(olderPath, new Date(now - 60_000), new Date(now - 60_000));
    require("node:fs").utimesSync(newerPath, new Date(now), new Date(now));

    const watcher = new CodexSessionWatcher(root);
    try {
      watcher.start(() => {});
      expect(watcher.lookupLatestByCwd("/tmp/ws-dupe")).toBe(
        "aaaaaaaa-0000-0000-0000-000000000002",
      );
    } finally {
      watcher.stop();
    }
  });

  it("skips symlinks during the seed walk to avoid infinite recursion", () => {
    writeRollout(
      "2026/03/03/rollout-1740960000-22222222-3333-4444-5555-666666666666.jsonl",
      {
        type: "session_meta",
        id: "22222222-3333-4444-5555-666666666666",
        cwd: "/tmp/ws-symlink",
      },
    );
    // Create a loop: root/loop -> root
    require("node:fs").symlinkSync(root, join(root, "loop"));

    const watcher = new CodexSessionWatcher(root);
    try {
      // Should return without stack-overflowing even though the loop exists.
      watcher.start(() => {});
      expect(watcher.lookupLatestByCwd("/tmp/ws-symlink")).toBe(
        "22222222-3333-4444-5555-666666666666",
      );
    } finally {
      watcher.stop();
    }
  });
});
