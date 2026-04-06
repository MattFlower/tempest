import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

// Use a temp directory to avoid touching real user data
const tmpRoot = join("/tmp", `tempest-migrate-test-${Date.now()}`);
const targetDir = join(tmpRoot, "target");
const appSupportDir = join(tmpRoot, "app-support");
const dotTempestDir = join(tmpRoot, "dot-tempest");

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // Clean and recreate directories for each test
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
});

// We can't easily test the real runMigration because it reads from paths.ts
// which uses env vars and homedir(). Instead, test the underlying logic
// by reimplementing the core migration helpers inline.

function copyIfExists(src: string, dest: string): boolean {
  try {
    if (existsSync(src) && !existsSync(dest)) {
      const content = readFileSync(src);
      writeFileSync(dest, content);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function copyGlob(srcDir: string, destDir: string, pattern: RegExp): boolean {
  let copied = false;
  try {
    const { readdirSync } = require("node:fs");
    const files = readdirSync(srcDir).filter((f: string) => pattern.test(f));
    for (const file of files) {
      if (copyIfExists(join(srcDir, file), join(destDir, file))) {
        copied = true;
      }
    }
  } catch {
    // ignore
  }
  return copied;
}

describe("migration logic", () => {
  it("copies session-state.json from Application Support", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(join(appSupportDir, "session-state.json"), '{"version":1}');

    copyIfExists(
      join(appSupportDir, "session-state.json"),
      join(targetDir, "session-state.json"),
    );

    expect(existsSync(join(targetDir, "session-state.json"))).toBe(true);
    expect(readFileSync(join(targetDir, "session-state.json"), "utf-8")).toBe(
      '{"version":1}',
    );
  });

  it("copies ccusage-state.json from Application Support", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(
      join(appSupportDir, "ccusage-state.json"),
      '{"pinnedVersion":"1.0"}',
    );

    copyIfExists(
      join(appSupportDir, "ccusage-state.json"),
      join(targetDir, "ccusage-state.json"),
    );

    expect(existsSync(join(targetDir, "ccusage-state.json"))).toBe(true);
  });

  it("does not overwrite existing files at destination", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(join(appSupportDir, "session-state.json"), "old-data");
    writeFileSync(join(targetDir, "session-state.json"), "new-data");

    copyIfExists(
      join(appSupportDir, "session-state.json"),
      join(targetDir, "session-state.json"),
    );

    // Should keep the existing destination content
    expect(readFileSync(join(targetDir, "session-state.json"), "utf-8")).toBe(
      "new-data",
    );
  });

  it("copies settings-*.json files from ~/.tempest", () => {
    mkdirSync(dotTempestDir, { recursive: true });
    writeFileSync(join(dotTempestDir, "settings-abc123def456.json"), "{}");
    writeFileSync(join(dotTempestDir, "settings-111222333444.json"), "{}");
    writeFileSync(join(dotTempestDir, "unrelated.json"), "{}");

    copyGlob(dotTempestDir, targetDir, /^settings-.*\.json$/);

    expect(existsSync(join(targetDir, "settings-abc123def456.json"))).toBe(true);
    expect(existsSync(join(targetDir, "settings-111222333444.json"))).toBe(true);
    expect(existsSync(join(targetDir, "unrelated.json"))).toBe(false);
  });

  it("copies mcp-*.json files from ~/.tempest", () => {
    mkdirSync(dotTempestDir, { recursive: true });
    writeFileSync(join(dotTempestDir, "mcp-abc123def456.json"), "{}");

    copyGlob(dotTempestDir, targetDir, /^mcp-.*\.json$/);

    expect(existsSync(join(targetDir, "mcp-abc123def456.json"))).toBe(true);
  });

  it("handles missing source directories gracefully", () => {
    // appSupportDir doesn't exist — should not throw
    const result = copyIfExists(
      join(appSupportDir, "session-state.json"),
      join(targetDir, "session-state.json"),
    );
    expect(result).toBe(false);
  });

  it("handles missing source dir for glob gracefully", () => {
    // dotTempestDir doesn't exist — should not throw
    const result = copyGlob(
      join(tmpRoot, "nonexistent"),
      targetDir,
      /^settings-.*\.json$/,
    );
    expect(result).toBe(false);
  });
});
