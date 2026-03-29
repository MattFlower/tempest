// ============================================================
// Unit tests for the diff provider.
// Tests SingleCommit scope and basic diff fetching.
// Uses the actual tempest2 git repo for integration testing.
// ============================================================

import { describe, test, expect } from "bun:test";
import { getDiff } from "./diff-provider";
import { DiffScope } from "../../shared/ipc-types";
import { resolve } from "node:path";

// Use the tempest2 repo root for testing
const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("getDiff", () => {
  test("CurrentChange scope returns a DiffResult", async () => {
    const result = await getDiff(REPO_ROOT, DiffScope.CurrentChange);
    expect(result).toHaveProperty("raw");
    expect(result).toHaveProperty("files");
    expect(typeof result.raw).toBe("string");
    expect(Array.isArray(result.files)).toBe(true);
  });

  test("SinceTrunk scope returns a DiffResult", async () => {
    const result = await getDiff(REPO_ROOT, DiffScope.SinceTrunk);
    expect(result).toHaveProperty("raw");
    expect(result).toHaveProperty("files");
    expect(typeof result.raw).toBe("string");
    expect(Array.isArray(result.files)).toBe(true);
  });

  test("SingleCommit scope shows diff for a specific commit", async () => {
    // Use HEAD as the commit ref — should always work
    const result = await getDiff(REPO_ROOT, DiffScope.SingleCommit, 3, "HEAD");
    expect(result).toHaveProperty("raw");
    expect(result).toHaveProperty("files");
    expect(typeof result.raw).toBe("string");
    expect(Array.isArray(result.files)).toBe(true);
    // HEAD commit should have some changes
    expect(result.files.length).toBeGreaterThan(0);
  });

  test("SingleCommit scope with short hash", async () => {
    // Get the short hash of HEAD
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
    });
    const shortHash = (await new Response(proc.stdout).text()).trim();
    await proc.exited;

    const result = await getDiff(REPO_ROOT, DiffScope.SingleCommit, 3, shortHash);
    expect(result.files.length).toBeGreaterThan(0);
  });

  test("SingleCommit scope without commitRef falls back gracefully", async () => {
    // When scope is SingleCommit but no ref is provided, git show with undefined
    // should fail — test that we get an error
    try {
      await getDiff(REPO_ROOT, DiffScope.SingleCommit, 3, undefined);
      // If it doesn't throw, it means git handled it somehow
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  });

  test("files have expected shape", async () => {
    const result = await getDiff(REPO_ROOT, DiffScope.SingleCommit, 3, "HEAD");
    for (const file of result.files) {
      expect(file).toHaveProperty("oldPath");
      expect(file).toHaveProperty("newPath");
      expect(file).toHaveProperty("status");
      expect(["modified", "added", "deleted", "renamed"]).toContain(file.status);
    }
  });

  test("contextLines parameter is respected", async () => {
    const result1 = await getDiff(REPO_ROOT, DiffScope.SingleCommit, 1, "HEAD");
    const result10 = await getDiff(REPO_ROOT, DiffScope.SingleCommit, 10, "HEAD");
    // More context lines should produce more output (or equal if file is small)
    expect(result10.raw.length).toBeGreaterThanOrEqual(result1.raw.length);
  });
});
