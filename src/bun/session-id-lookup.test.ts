import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lookupPlanPath } from "./session-id-lookup";

const tmpRoot = join("/tmp", `tempest-session-id-lookup-test-${Date.now()}`);

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

describe("lookupPlanPath", () => {
  it("finds a plan from a large transcript without needing to load the full file", () => {
    const claudeDir = join(tmpRoot, ".claude");
    const workspacePath = "/tmp/workspace-a";
    const encodedPath = workspacePath.replace(/\//g, "-");
    const sessionId = "session-1";
    const slug = "alpha-bravo-charlie";

    const transcriptDir = join(claudeDir, "projects", encodedPath);
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);
    const planPath = join(claudeDir, "plans", `${slug}.md`);

    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(join(claudeDir, "plans"), { recursive: true });

    const headerLines = Array.from({ length: 20 }, (_, i) => `{"line":${i}}`).join("\n");
    const largeTail = "x".repeat(2 * 1024 * 1024);
    writeFileSync(
      transcriptPath,
      `${headerLines}\n{"slug":"${slug}"}\n${largeTail}`,
      "utf-8",
    );
    writeFileSync(planPath, "# plan\n", "utf-8");

    expect(lookupPlanPath(sessionId, workspacePath, claudeDir)).toBe(planPath);
  });

  it("parses slug from a final line without a trailing newline", () => {
    const claudeDir = join(tmpRoot, ".claude");
    const workspacePath = "/tmp/workspace-b";
    const encodedPath = workspacePath.replace(/\//g, "-");
    const sessionId = "session-2";
    const slug = "delta-echo-foxtrot";

    const transcriptDir = join(claudeDir, "projects", encodedPath);
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);
    const planPath = join(claudeDir, "plans", `${slug}.md`);

    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(join(claudeDir, "plans"), { recursive: true });

    writeFileSync(transcriptPath, `{"slug":"${slug}"}`, "utf-8");
    writeFileSync(planPath, "# plan\n", "utf-8");

    expect(lookupPlanPath(sessionId, workspacePath, claudeDir)).toBe(planPath);
  });

  it("returns null when the slug does not appear in the first 100 lines", () => {
    const claudeDir = join(tmpRoot, ".claude");
    const workspacePath = "/tmp/workspace-c";
    const encodedPath = workspacePath.replace(/\//g, "-");
    const sessionId = "session-3";

    const transcriptDir = join(claudeDir, "projects", encodedPath);
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);

    mkdirSync(transcriptDir, { recursive: true });

    // 150 lines, none containing a slug
    const lines = Array.from({ length: 150 }, (_, i) => `{"line":${i}}`).join("\n");
    writeFileSync(transcriptPath, lines, "utf-8");

    expect(lookupPlanPath(sessionId, workspacePath, claudeDir)).toBeNull();
  });
});
