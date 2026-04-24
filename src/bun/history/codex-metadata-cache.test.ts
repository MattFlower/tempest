import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CodexHistoryMetadataCache,
  extractSessionIdFromFilename,
} from "./codex-metadata-cache";

let sessionsDir: string;
let cacheFile: string;

beforeEach(() => {
  const root = join("/tmp", `tempest-codex-cache-${Date.now()}-${Math.random()}`);
  sessionsDir = join(root, "sessions");
  cacheFile = join(root, "codex-history-cache.json");
  mkdirSync(sessionsDir, { recursive: true });
});

afterEach(() => {
  const root = join(sessionsDir, "..");
  rmSync(root, { recursive: true, force: true });
});

function writeRollout(
  relativePath: string,
  lines: object[],
): string {
  const fullPath = join(sessionsDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(fullPath, body);
  return fullPath;
}

describe("CodexHistoryMetadataCache", () => {
  it("scans date-nested rollouts and extracts metadata from the header", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    writeRollout(`2026/01/15/rollout-1705329600-${uuid}.jsonl`, [
      { type: "session_meta", id: uuid, timestamp: "2026-01-15T12:00:00Z", cwd: "/tmp/ws-a" },
      { type: "response_item", item: { type: "message", role: "user", content: "first prompt for A" } },
    ]);

    const uuid2 = "66666666-7777-8888-9999-aaaaaaaaaaaa";
    writeRollout(`2026/02/20/rollout-1708435200-${uuid2}.jsonl`, [
      { type: "session_meta", id: uuid2, timestamp: "2026-02-20T08:00:00Z", cwd: "/tmp/ws-b" },
      { type: "response_item", item: { type: "message", role: "user", content: "hello B" } },
    ]);

    const cache = new CodexHistoryMetadataCache(sessionsDir, cacheFile);
    cache.scan();

    const all = cache.sessions("all");
    expect(all).toHaveLength(2);

    const aSessions = cache.sessions("project", "/tmp/ws-a");
    expect(aSessions).toHaveLength(1);
    expect(aSessions[0]!.firstPrompt).toBe("first prompt for A");
    expect(aSessions[0]!.codexSessionId).toBe(uuid);

    // projectDirsForWorkspace returns a date-nested subdir, not the sessions root
    const dirs = cache.projectDirsForWorkspace("/tmp/ws-a");
    expect(dirs).toEqual(["2026/01/15"]);
  });

  it("re-uses cached entries when mtime+size are unchanged", () => {
    const uuid = "cafecafe-cafe-cafe-cafe-cafecafecafe";
    const rel = `2026/01/15/rollout-1705329600-${uuid}.jsonl`;
    writeRollout(rel, [
      { type: "session_meta", id: uuid, timestamp: "2026-01-15T12:00:00Z", cwd: "/tmp/ws" },
      { type: "response_item", item: { type: "message", role: "user", content: "hi" } },
    ]);

    const cache = new CodexHistoryMetadataCache(sessionsDir, cacheFile);
    cache.scan();
    const before = cache.sessions("all")[0]!;

    cache.scan();
    const after = cache.sessions("all")[0]!;

    expect(after.filePath).toBe(before.filePath);
    expect(after.firstPrompt).toBe(before.firstPrompt);
  });

  it("extractSessionIdFromFilename recovers the uuid suffix", () => {
    expect(
      extractSessionIdFromFilename(
        "/x/rollout-1705329600-abcdef12-3456-7890-abcd-0123456789ab.jsonl",
      ),
    ).toBe("abcdef12-3456-7890-abcd-0123456789ab");
    expect(extractSessionIdFromFilename("/x/not-a-rollout.jsonl")).toBeUndefined();
  });
});
