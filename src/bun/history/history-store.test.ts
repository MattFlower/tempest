import { describe, test, expect, mock } from "bun:test";
import { HistoryStore } from "./history-store";
import type { SessionSummaryData, CachedSession } from "./metadata-cache";

function summaryForPath(filePath: string): SessionSummaryData {
  return {
    filePath,
    firstPrompt: "Test",
    modifiedAt: "2026-01-01T00:00:00Z",
  };
}

function cachedSessionForPath(filePath: string, fileMtime = 1): CachedSession {
  return {
    sessionId: filePath,
    projectPath: "project",
    filePath,
    fileMtime,
    fileSize: 1,
    firstPrompt: "Test",
    modifiedAt: "2026-01-01T00:00:00Z",
  };
}

function emptyEditIndexEntry(mtime = 1) {
  return {
    mtime,
    fullPaths: new Set<string>(),
    baseNames: new Set<string>(),
    summaries: [] as string[],
  };
}

describe("HistoryStore cache pruning", () => {
  test("refresh prunes orphaned parse/edit cache entries", async () => {
    const store = new HistoryStore() as any;

    const keepPath = "/tmp/keep.jsonl";
    const removePath = "/tmp/remove.jsonl";

    const scan = mock(() => {});
    const save = mock(async () => {});

    store.cache = {
      scan,
      save,
      sessions: mock(() => [summaryForPath(keepPath)]),
    };

    store.parseCache = new Map([
      [keepPath, { mtime: 1, messages: [] }],
      [removePath, { mtime: 1, messages: [] }],
    ]);
    store.editIndex = new Map([
      [keepPath, emptyEditIndexEntry()],
      [removePath, emptyEditIndexEntry()],
    ]);

    await store.refresh();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);

    expect(store.parseCache.has(keepPath)).toBeTrue();
    expect(store.parseCache.has(removePath)).toBeFalse();

    expect(store.editIndex.has(keepPath)).toBeTrue();
    expect(store.editIndex.has(removePath)).toBeFalse();
  });

  test("pruneDerivedCaches enforces cache size limits with oldest-first eviction", () => {
    const store = new HistoryStore() as any;

    const parsePaths = Array.from({ length: 400 }, (_, i) => `/tmp/parse-${i}.jsonl`);
    const editPaths = Array.from({ length: 1100 }, (_, i) => `/tmp/edit-${i}.jsonl`);
    const allLivePaths = [...parsePaths, ...editPaths];

    store.cache = {
      sessions: mock(() => allLivePaths.map(summaryForPath)),
    };

    store.parseCache = new Map(
      parsePaths.map((path) => [path, { mtime: 1, messages: [] }]),
    );
    store.editIndex = new Map(
      editPaths.map((path) => [path, emptyEditIndexEntry()]),
    );

    store.pruneDerivedCaches();

    expect(store.parseCache.size).toBe(300);
    expect(store.parseCache.has(parsePaths[0]!)).toBeFalse();
    expect(store.parseCache.has(parsePaths[99]!)).toBeFalse();
    expect(store.parseCache.has(parsePaths[100]!)).toBeTrue();
    expect(store.parseCache.has(parsePaths[399]!)).toBeTrue();

    expect(store.editIndex.size).toBe(1000);
    expect(store.editIndex.has(editPaths[0]!)).toBeFalse();
    expect(store.editIndex.has(editPaths[99]!)).toBeFalse();
    expect(store.editIndex.has(editPaths[100]!)).toBeTrue();
    expect(store.editIndex.has(editPaths[1099]!)).toBeTrue();
  });

  test("cache hit marks parse/edit entries as recently used", async () => {
    const store = new HistoryStore() as any;

    const aPath = "/tmp/a.jsonl";
    const bPath = "/tmp/b.jsonl";

    store.parseCache = new Map([
      [aPath, { mtime: 1, messages: [] }],
      [bPath, { mtime: 1, messages: [] }],
    ]);

    store.editIndex = new Map([
      [aPath, emptyEditIndexEntry(1)],
      [bPath, emptyEditIndexEntry(1)],
    ]);

    const sessionA = cachedSessionForPath(aPath, 1);

    await store.getParsedForSession(sessionA);
    expect([...store.parseCache.keys()]).toEqual([bPath, aPath]);

    await store.getEditIndexForSession(sessionA);
    expect([...store.editIndex.keys()]).toEqual([bPath, aPath]);
  });
});
