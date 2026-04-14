import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PiHistoryMetadataCache } from "./pi-metadata-cache";

const tmpRoot = join("/tmp", `tempest-pi-metadata-cache-test-${Date.now()}`);
const fakeSessionsDir = join(tmpRoot, "sessions");
const fakeCacheFile = join(tmpRoot, "pi-history-cache.json");

const projectDirA = "--Users-me-project-a--";
const projectDirB = "--Users-me-project-b--";
const workspaceA = "/Users/me/project/a";
const workspaceB = "/Users/me/project/b";

function sessionHeader(cwd: string, id: string, ts: string) {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: ts,
    cwd,
  });
}

function userMessage(text: string, ts: string) {
  return JSON.stringify({
    type: "message",
    id: "u" + Math.random().toString(36).slice(2, 7),
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function setupProjectDirs() {
  mkdirSync(join(fakeSessionsDir, projectDirA), { recursive: true });
  mkdirSync(join(fakeSessionsDir, projectDirB), { recursive: true });
}

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("PiHistoryMetadataCache", () => {
  beforeEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    setupProjectDirs();
  });

  it("scans and returns session summaries", () => {
    const file = join(
      fakeSessionsDir,
      projectDirA,
      "2026-04-14T00-00-00-000Z_abc.jsonl",
    );
    writeFileSync(
      file,
      [
        sessionHeader(workspaceA, "sess-a", "2026-04-14T00:00:00Z"),
        userMessage("What is 2+2?", "2026-04-14T00:00:01Z"),
      ].join("\n") + "\n",
    );

    const cache = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    cache.scan();

    const sessions = cache.sessions("all");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.firstPrompt).toBe("What is 2+2?");
    expect(sessions[0]!.filePath).toBe(file);
    expect(sessions[0]!.createdAt).toBe("2026-04-14T00:00:00Z");
  });

  it("filters project scope by absolute workspacePath from the session header", () => {
    writeFileSync(
      join(
        fakeSessionsDir,
        projectDirA,
        "2026-04-14T00-00-00-000Z_a.jsonl",
      ),
      [
        sessionHeader(workspaceA, "sess-a", "2026-04-14T00:00:00Z"),
        userMessage("Prompt A", "2026-04-14T00:00:01Z"),
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(
        fakeSessionsDir,
        projectDirB,
        "2026-04-14T01-00-00-000Z_b.jsonl",
      ),
      [
        sessionHeader(workspaceB, "sess-b", "2026-04-14T01:00:00Z"),
        userMessage("Prompt B", "2026-04-14T01:00:01Z"),
      ].join("\n") + "\n",
    );

    const cache = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    cache.scan();

    expect(cache.sessions("all")).toHaveLength(2);
    const matched = cache.sessions("project", workspaceA);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.firstPrompt).toBe("Prompt A");
    expect(cache.sessions("project", "/unrelated")).toHaveLength(0);
  });

  it("skips XML-tagged user messages when picking firstPrompt", () => {
    const file = join(
      fakeSessionsDir,
      projectDirA,
      "2026-04-14T02-00-00-000Z_c.jsonl",
    );
    writeFileSync(
      file,
      [
        sessionHeader(workspaceA, "sess-c", "2026-04-14T02:00:00Z"),
        userMessage("<tool_result>ignored</tool_result>", "2026-04-14T02:00:01Z"),
        userMessage("Actual prompt", "2026-04-14T02:00:02Z"),
      ].join("\n") + "\n",
    );

    const cache = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    cache.scan();
    expect(cache.sessions("all")[0]!.firstPrompt).toBe("Actual prompt");
  });

  it("projectDirsForWorkspace returns the encoded directories for a workspace", () => {
    writeFileSync(
      join(fakeSessionsDir, projectDirA, "x.jsonl"),
      sessionHeader(workspaceA, "s1", "2026-04-14T00:00:00Z") + "\n",
    );
    writeFileSync(
      join(fakeSessionsDir, projectDirB, "y.jsonl"),
      sessionHeader(workspaceB, "s2", "2026-04-14T00:00:00Z") + "\n",
    );

    const cache = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    cache.scan();

    const dirs = cache.projectDirsForWorkspace(workspaceA);
    expect(dirs).toEqual([projectDirA]);
  });

  it("round-trips through persistence", async () => {
    const file = join(
      fakeSessionsDir,
      projectDirA,
      "2026-04-14T00-00-00-000Z_persisted.jsonl",
    );
    writeFileSync(
      file,
      [
        sessionHeader(workspaceA, "sess-p", "2026-04-14T00:00:00Z"),
        userMessage("Persisted prompt", "2026-04-14T00:00:01Z"),
      ].join("\n") + "\n",
    );

    const cache1 = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    cache1.scan();
    await cache1.save();

    const cache2 = new PiHistoryMetadataCache(fakeSessionsDir, fakeCacheFile);
    await cache2.load();
    const sessions = cache2.sessions("all");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.firstPrompt).toBe("Persisted prompt");
  });
});
