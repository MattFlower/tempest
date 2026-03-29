import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { HistoryMetadataCache } from "./metadata-cache";

// Build a unique temp root for this test run
const tmpRoot = join("/tmp", `tempest-metadata-cache-test-${Date.now()}`);
const fakeClaudeDir = join(tmpRoot, ".claude");
const fakeProjectsDir = join(fakeClaudeDir, "projects");
const fakeCacheFile = join(tmpRoot, "history-cache.json");

// Encoded project paths (mimicking the real structure)
const projectA = "encoded-project-a";
const projectB = "encoded-project-b";

// Helper to build a JSONL line representing a user message
function userLine(content: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    message: { content },
    ...extra,
  });
}

// Helper to build a system message line (should be skipped for firstPrompt)
function systemLine(content: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "system",
    content,
    ...extra,
  });
}

function setupDirectories() {
  mkdirSync(join(fakeProjectsDir, projectA), { recursive: true });
  mkdirSync(join(fakeProjectsDir, projectB), { recursive: true });
}

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("HistoryMetadataCache", () => {
  beforeEach(() => {
    // Clean and recreate temp structure before each test
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    setupDirectories();
  });

  describe("scan + sessions", () => {
    it("returns session summaries for JSONL files", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "session-001.jsonl");
      const lines = [
        systemLine("System init", { timestamp: "2026-03-01T10:00:00Z" }),
        userLine("<hook_result>ignored xml</hook_result>", {
          timestamp: "2026-03-01T10:00:01Z",
          gitBranch: "main",
        }),
        userLine("What is the meaning of life?", {
          timestamp: "2026-03-01T10:00:02Z",
          gitBranch: "main",
        }),
      ];
      writeFileSync(sessionFile, lines.join("\n") + "\n");

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const sessions = cache.sessions("all");

      expect(sessions.length).toBe(1);
      const s = sessions[0]!;
      expect(s.filePath).toBe(sessionFile);
    });

    it("extracts firstPrompt skipping XML-tagged messages", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "session-002.jsonl");
      const lines = [
        userLine("<tool_result>some result</tool_result>", {
          timestamp: "2026-03-01T10:00:00Z",
        }),
        userLine("Hello, this is my real prompt", {
          timestamp: "2026-03-01T10:00:01Z",
        }),
      ];
      writeFileSync(sessionFile, lines.join("\n") + "\n");

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const sessions = cache.sessions("all");

      expect(sessions[0]!.firstPrompt).toBe("Hello, this is my real prompt");
    });

    it("extracts createdAt from the first message timestamp", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "session-003.jsonl");
      const lines = [
        userLine("Hello", { timestamp: "2026-03-15T08:30:00Z" }),
        userLine("Another message", { timestamp: "2026-03-15T09:00:00Z" }),
      ];
      writeFileSync(sessionFile, lines.join("\n") + "\n");

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const sessions = cache.sessions("all");

      expect(sessions[0]!.createdAt).toBe("2026-03-15T08:30:00Z");
    });

    it("extracts gitBranch from messages", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "session-004.jsonl");
      const lines = [
        userLine("Fix the bug", {
          timestamp: "2026-03-15T08:30:00Z",
          gitBranch: "feature/cool-thing",
        }),
      ];
      writeFileSync(sessionFile, lines.join("\n") + "\n");

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const sessions = cache.sessions("all");

      expect(sessions[0]!.gitBranch).toBe("feature/cool-thing");
    });

    it("derives modifiedAt from file mtime", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "session-005.jsonl");
      writeFileSync(sessionFile, userLine("hi", { timestamp: "2026-01-01T00:00:00Z" }) + "\n");

      // Set a known mtime
      const knownDate = new Date("2026-02-14T12:00:00Z");
      utimesSync(sessionFile, knownDate, knownDate);

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const sessions = cache.sessions("all");

      expect(sessions[0]!.modifiedAt).toBe(knownDate.toISOString());
    });
  });

  describe("sessions filtering", () => {
    function setupTwoProjects() {
      const fileA = join(fakeProjectsDir, projectA, "sess-a.jsonl");
      const fileB = join(fakeProjectsDir, projectB, "sess-b.jsonl");
      writeFileSync(
        fileA,
        userLine("Prompt A", { timestamp: "2026-03-01T10:00:00Z" }) + "\n",
      );
      writeFileSync(
        fileB,
        userLine("Prompt B", { timestamp: "2026-03-02T10:00:00Z" }) + "\n",
      );
      return { fileA, fileB };
    }

    it("with scope 'project' and matching projectPath returns only matching sessions", () => {
      setupTwoProjects();
      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();

      const sessions = cache.sessions("project", projectA);
      expect(sessions.length).toBe(1);
      expect(sessions[0]!.firstPrompt).toBe("Prompt A");
    });

    it("with scope 'project' and non-matching projectPath returns empty", () => {
      setupTwoProjects();
      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();

      const sessions = cache.sessions("project", "nonexistent-project");
      expect(sessions.length).toBe(0);
    });

    it("with scope 'all' returns all sessions", () => {
      setupTwoProjects();
      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();

      const sessions = cache.sessions("all");
      expect(sessions.length).toBe(2);
      const prompts = sessions.map((s) => s.firstPrompt).sort();
      expect(prompts).toEqual(["Prompt A", "Prompt B"]);
    });
  });

  describe("cache invalidation", () => {
    it("re-extracts metadata when a file is modified", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "sess-inv.jsonl");
      writeFileSync(
        sessionFile,
        userLine("Original prompt", { timestamp: "2026-03-01T10:00:00Z" }) + "\n",
      );

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      expect(cache.sessions("all")[0]!.firstPrompt).toBe("Original prompt");

      // Modify the file content and touch its mtime to ensure cache invalidation
      const futureDate = new Date(Date.now() + 5000);
      writeFileSync(
        sessionFile,
        userLine("Updated prompt", { timestamp: "2026-03-01T10:00:00Z" }) + "\n",
      );
      utimesSync(sessionFile, futureDate, futureDate);

      cache.scan();
      expect(cache.sessions("all")[0]!.firstPrompt).toBe("Updated prompt");
    });

    it("reuses cached entries when file has not changed", () => {
      const sessionFile = join(fakeProjectsDir, projectA, "sess-cached.jsonl");
      writeFileSync(
        sessionFile,
        userLine("Stable prompt", { timestamp: "2026-03-01T10:00:00Z" }) + "\n",
      );

      const cache = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache.scan();
      const first = cache.sessions("all")[0]!;

      // Scan again without changes
      cache.scan();
      const second = cache.sessions("all")[0]!;

      expect(second.firstPrompt).toBe(first.firstPrompt);
      expect(second.firstPrompt).toBe("Stable prompt");
    });
  });

  describe("save and load", () => {
    it("persists and restores sessions across instances", async () => {
      const sessionFile = join(fakeProjectsDir, projectA, "sess-persist.jsonl");
      writeFileSync(
        sessionFile,
        userLine("Persistent prompt", {
          timestamp: "2026-03-20T14:00:00Z",
          gitBranch: "develop",
        }) + "\n",
      );

      // First instance: scan and save
      const cache1 = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      cache1.scan();
      const sessionsBefore = cache1.sessions("all");
      expect(sessionsBefore.length).toBe(1);
      await cache1.save();

      // Second instance: load from cache file
      const cache2 = new HistoryMetadataCache(fakeClaudeDir, fakeCacheFile);
      await cache2.load();
      const sessionsAfter = cache2.sessions("all");

      expect(sessionsAfter.length).toBe(sessionsBefore.length);
      expect(sessionsAfter[0]!.firstPrompt).toBe(sessionsBefore[0]!.firstPrompt);
      expect(sessionsAfter[0]!.createdAt).toBe(sessionsBefore[0]!.createdAt);
      expect(sessionsAfter[0]!.gitBranch).toBe(sessionsBefore[0]!.gitBranch);
      expect(sessionsAfter[0]!.modifiedAt).toBe(sessionsBefore[0]!.modifiedAt);
    });
  });
});
