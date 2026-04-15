import { describe, it, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRipgrepJSON, RipgrepSearcher } from "./ripgrep-searcher";
import { PiRipgrepSearcher } from "./pi-ripgrep-searcher";

describe("parseRipgrepJSON", () => {
  it("returns empty array for empty string", () => {
    expect(parseRipgrepJSON("")).toEqual([]);
  });

  it("extracts file path from a single match line", () => {
    const line = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/home/user/.claude/projects/foo/session.jsonl" },
        lines: { text: "some matched content" },
        line_number: 42,
      },
    });
    expect(parseRipgrepJSON(line)).toEqual([
      "/home/user/.claude/projects/foo/session.jsonl",
    ]);
  });

  it("returns unique sorted paths from multiple matches across different files", () => {
    const lines = [
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/to/zebra.jsonl" },
          lines: { text: "hit" },
          line_number: 1,
        },
      }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/to/alpha.jsonl" },
          lines: { text: "hit" },
          line_number: 5,
        },
      }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/to/middle.jsonl" },
          lines: { text: "hit" },
          line_number: 10,
        },
      }),
    ].join("\n");

    expect(parseRipgrepJSON(lines)).toEqual([
      "/path/to/alpha.jsonl",
      "/path/to/middle.jsonl",
      "/path/to/zebra.jsonl",
    ]);
  });

  it("only extracts paths from match type, ignoring summary/end/begin", () => {
    const lines = [
      JSON.stringify({
        type: "begin",
        data: { path: { text: "/path/begin.jsonl" } },
      }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/real-match.jsonl" },
          lines: { text: "content" },
          line_number: 1,
        },
      }),
      JSON.stringify({
        type: "end",
        data: { path: { text: "/path/end.jsonl" }, stats: {} },
      }),
      JSON.stringify({
        type: "summary",
        data: {
          elapsed_total: { secs: 0, nanos: 1000 },
          stats: { searches: 1 },
        },
      }),
    ].join("\n");

    expect(parseRipgrepJSON(lines)).toEqual(["/path/real-match.jsonl"]);
  });

  it("skips malformed JSON lines gracefully", () => {
    const lines = [
      "this is not json at all",
      "{broken json",
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/valid.jsonl" },
          lines: { text: "ok" },
          line_number: 1,
        },
      }),
      "another bad line {{{",
    ].join("\n");

    expect(parseRipgrepJSON(lines)).toEqual(["/path/valid.jsonl"]);
  });

  it("deduplicates file paths", () => {
    const matchLine = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/path/to/same-file.jsonl" },
        lines: { text: "first hit" },
        line_number: 10,
      },
    });
    const matchLine2 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/path/to/same-file.jsonl" },
        lines: { text: "second hit" },
        line_number: 20,
      },
    });
    const matchLine3 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/path/to/same-file.jsonl" },
        lines: { text: "third hit" },
        line_number: 30,
      },
    });

    const output = [matchLine, matchLine2, matchLine3].join("\n");
    expect(parseRipgrepJSON(output)).toEqual(["/path/to/same-file.jsonl"]);
  });

  it("skips match lines with missing data.path.text", () => {
    const lines = [
      JSON.stringify({ type: "match", data: {} }),
      JSON.stringify({ type: "match", data: { path: {} } }),
      JSON.stringify({ type: "match", data: { path: { text: null } } }),
      JSON.stringify({ type: "match", data: { path: { text: 123 } } }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/path/good.jsonl" },
          lines: { text: "ok" },
          line_number: 1,
        },
      }),
    ].join("\n");

    expect(parseRipgrepJSON(lines)).toEqual(["/path/good.jsonl"]);
  });
});

describe("RipgrepSearcher", () => {
  it("isAvailable returns true when rg is installed", () => {
    const searcher = new RipgrepSearcher();
    expect(searcher.isAvailable).toBe(true);
  });

  it("returns empty results for project scope when projectPath is missing", async () => {
    const searcher = new RipgrepSearcher("/tmp/nonexistent-claude-dir");
    // Force a non-null rgPath so this test exercises the project-path guard.
    (searcher as any).rgPath = "rg";

    const results = await searcher.search("needle", "project");
    expect(results).toEqual([]);
  });

  it("handles queries starting with '-' as patterns, not flags", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "rg-search-test-"));
    try {
      const projectPath = "encoded-project";
      const projectDir = join(tempRoot, "projects", projectPath);
      await mkdir(projectDir, { recursive: true });

      const sessionFile = join(projectDir, "session.jsonl");
      await writeFile(
        sessionFile,
        JSON.stringify({ type: "user", message: { content: "contains -n" } }) + "\n",
      );

      const searcher = new RipgrepSearcher(tempRoot);
      (searcher as any).rgPath = "rg";

      const results = await searcher.search("-n", "project", projectPath);
      expect(results).toEqual([sessionFile]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("PiRipgrepSearcher", () => {
  it("handles queries starting with '-' as patterns, not flags", async () => {
    const sessionsRoot = await mkdtemp(join(tmpdir(), "pi-rg-search-test-"));
    try {
      const projectDir = "encoded-workspace";
      const fullProjectDir = join(sessionsRoot, projectDir);
      await mkdir(fullProjectDir, { recursive: true });

      const sessionFile = join(fullProjectDir, "session.jsonl");
      await writeFile(
        sessionFile,
        JSON.stringify({ type: "message", message: { role: "user", content: "contains -n" } }) + "\n",
      );

      const searcher = new PiRipgrepSearcher(sessionsRoot);
      (searcher as any).rgPath = "rg";

      const results = await searcher.search("-n", "project", [projectDir]);
      expect(results).toEqual([sessionFile]);
    } finally {
      await rm(sessionsRoot, { recursive: true, force: true });
    }
  });
});
