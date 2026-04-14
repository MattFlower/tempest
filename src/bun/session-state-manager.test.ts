import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStateManager } from "./session-state-manager";

const tmpRoot = join("/tmp", `tempest-session-state-test-${Date.now()}`);

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

describe("SessionStateManager repo collapse persistence", () => {
  it("persists collapsed repo ids across save/load", async () => {
    const first = new SessionStateManager(tmpRoot);
    first.setRepoCollapsed("repo-a", true);
    first.setRepoCollapsed("repo-b", true);
    await first.flush();

    const second = new SessionStateManager(tmpRoot);
    await second.load();

    expect(second.isRepoCollapsed("repo-a")).toBe(true);
    expect(second.isRepoCollapsed("repo-b")).toBe(true);
    expect(second.isRepoCollapsed("repo-c")).toBe(false);
  });

  it("persists un-collapsing a repo", async () => {
    const first = new SessionStateManager(tmpRoot);
    first.setRepoCollapsed("repo-a", true);
    await first.flush();

    const second = new SessionStateManager(tmpRoot);
    await second.load();
    second.setRepoCollapsed("repo-a", false);
    await second.flush();

    const third = new SessionStateManager(tmpRoot);
    await third.load();

    expect(third.isRepoCollapsed("repo-a")).toBe(false);
  });
});
