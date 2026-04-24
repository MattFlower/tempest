import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodexHistoryStore } from "./codex-history-store";
import { CodexHistoryMetadataCache } from "./codex-metadata-cache";

let root: string;
let sessionsDir: string;
let cacheFile: string;

beforeEach(() => {
  root = join("/tmp", `tempest-codex-store-${Date.now()}-${Math.random()}`);
  sessionsDir = join(root, "sessions");
  cacheFile = join(root, "codex-history-cache.json");
  mkdirSync(sessionsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRollout(relativePath: string, lines: object[]): string {
  const fullPath = join(sessionsDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(
    fullPath,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
  return fullPath;
}

describe("CodexHistoryStore", () => {
  it("finds sessions with Codex custom_tool_call edits for AI Context", async () => {
    const rolloutPath = writeRollout(
      "2026/01/15/rollout-1705329600-11111111-2222-3333-4444-555555555555.jsonl",
      [
        {
          type: "session_meta",
          id: "11111111-2222-3333-4444-555555555555",
          cwd: "/tmp/ws-a",
          timestamp: "2026-01-15T12:00:00Z",
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            call_id: "call-123",
            name: "apply_patch",
            input: "*** Begin Patch\n*** Update File: src/app.ts\n",
          },
        },
      ],
    );

    const store = new CodexHistoryStore(
      new CodexHistoryMetadataCache(sessionsDir, cacheFile),
      { isAvailable: false, search: async () => [] },
    );

    const results = await store.sessionsWithToolCallsForFile(
      "/tmp/ws-a/src/app.ts",
      "project",
      "/tmp/ws-a",
    );

    expect(results.map((s) => s.filePath)).toEqual([rolloutPath]);
  });

  it("filters ripgrep project-search hits back to the requested workspace", async () => {
    const wsAPath = writeRollout(
      "2026/01/15/rollout-1705329600-11111111-2222-3333-4444-555555555555.jsonl",
      [
        {
          type: "session_meta",
          id: "11111111-2222-3333-4444-555555555555",
          cwd: "/tmp/ws-a",
          timestamp: "2026-01-15T12:00:00Z",
        },
        {
          type: "response_item",
          item: { type: "message", role: "user", content: "needle in A" },
        },
      ],
    );
    const wsBPath = writeRollout(
      "2026/01/15/rollout-1705329600-66666666-7777-8888-9999-aaaaaaaaaaaa.jsonl",
      [
        {
          type: "session_meta",
          id: "66666666-7777-8888-9999-aaaaaaaaaaaa",
          cwd: "/tmp/ws-b",
          timestamp: "2026-01-15T13:00:00Z",
        },
        {
          type: "response_item",
          item: { type: "message", role: "user", content: "needle in B" },
        },
      ],
    );

    const searchedProjectDirs: string[][] = [];
    const store = new CodexHistoryStore(
      new CodexHistoryMetadataCache(sessionsDir, cacheFile),
      {
        isAvailable: true,
        async search(_query, _scope, projectDirs) {
          searchedProjectDirs.push(projectDirs ?? []);
          return [wsAPath, wsBPath];
        },
      },
    );

    const results = await store.searchSessions(
      "needle",
      "project",
      "/tmp/ws-a",
    );

    expect(searchedProjectDirs).toEqual([["2026/01/15"]]);
    expect(results.map((s) => s.filePath)).toEqual([wsAPath]);
  });
});
