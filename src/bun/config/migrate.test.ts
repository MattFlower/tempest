import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { runMigration } from "./migrate";

// Use a temp directory to avoid touching real user data.
const tmpRoot = join("/tmp", `tempest-migrate-test-${Date.now()}`);
const targetDir = join(tmpRoot, "target");
const homeDir = join(tmpRoot, "home");
const appSupportDir = join(
  homeDir,
  "Library",
  "Application Support",
  "Tempest",
);
const dotTempestDir = join(homeDir, ".tempest");
const markerFile = join(targetDir, ".migrated");

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // Clean and recreate directories for each test.
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(homeDir, { recursive: true });
});

function runTestMigration(env: NodeJS.ProcessEnv = {}): void {
  runMigration({
    tempestDir: targetDir,
    homeDir,
    env,
    logger: () => {},
    warnLogger: () => {},
    errorLogger: () => {},
  });
}

describe("runMigration", () => {
  it("copies session-state.json from Application Support", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(join(appSupportDir, "session-state.json"), '{"version":1}');

    runTestMigration();

    expect(existsSync(join(targetDir, "session-state.json"))).toBe(true);
    expect(readFileSync(join(targetDir, "session-state.json"), "utf-8")).toBe(
      '{"version":1}',
    );
    expect(existsSync(markerFile)).toBe(true);
  });

  it("copies ccusage-state.json from Application Support", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(
      join(appSupportDir, "ccusage-state.json"),
      '{"pinnedVersion":"1.0"}',
    );

    runTestMigration();

    expect(existsSync(join(targetDir, "ccusage-state.json"))).toBe(true);
    expect(existsSync(markerFile)).toBe(true);
  });

  it("does not overwrite existing files at destination", () => {
    mkdirSync(appSupportDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(appSupportDir, "session-state.json"), "old-data");
    writeFileSync(join(targetDir, "session-state.json"), "new-data");

    runTestMigration();

    expect(readFileSync(join(targetDir, "session-state.json"), "utf-8")).toBe(
      "new-data",
    );
  });

  it("copies settings-*.json files from ~/.tempest", () => {
    mkdirSync(dotTempestDir, { recursive: true });
    writeFileSync(join(dotTempestDir, "settings-abc123def456.json"), "{}");
    writeFileSync(join(dotTempestDir, "settings-111222333444.json"), "{}");
    writeFileSync(join(dotTempestDir, "unrelated.json"), "{}");

    runTestMigration();

    expect(existsSync(join(targetDir, "settings-abc123def456.json"))).toBe(true);
    expect(existsSync(join(targetDir, "settings-111222333444.json"))).toBe(true);
    expect(existsSync(join(targetDir, "unrelated.json"))).toBe(false);
  });

  it("copies mcp-*.json files from ~/.tempest", () => {
    mkdirSync(dotTempestDir, { recursive: true });
    writeFileSync(join(dotTempestDir, "mcp-abc123def456.json"), "{}");

    runTestMigration();

    expect(existsSync(join(targetDir, "mcp-abc123def456.json"))).toBe(true);
  });

  it("handles missing source directories gracefully and still writes marker", () => {
    runTestMigration();

    expect(existsSync(join(targetDir, "session-state.json"))).toBe(false);
    expect(existsSync(join(targetDir, "ccusage-state.json"))).toBe(false);
    expect(existsSync(markerFile)).toBe(true);
  });

  it("does not write marker if migration encounters copy errors", () => {
    mkdirSync(join(appSupportDir, "session-state.json"), { recursive: true });

    runTestMigration();

    expect(existsSync(markerFile)).toBe(false);
  });

  it("skips migration entirely when TEMPEST_CONFIG_DIR is set", () => {
    mkdirSync(appSupportDir, { recursive: true });
    writeFileSync(join(appSupportDir, "session-state.json"), '{"version":1}');

    runTestMigration({ TEMPEST_CONFIG_DIR: "/custom/tempest" });

    expect(existsSync(targetDir)).toBe(false);
  });
});
