import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("extractInlineScrollback pulls legacy inline scrollback out of the tree", async () => {
    // load() prunes workspaces whose directories no longer exist, so the test
    // workspace path must really exist for the state to survive reload.
    const wsPath = join(tmpRoot, "workspace");
    mkdirSync(wsPath, { recursive: true });

    const first = new SessionStateManager(tmpRoot);
    // Simulate a pre-split session-state.json that has scrollbackContent inlined on a tab.
    const legacyTree = {
      type: "leaf",
      pane: {
        tabs: [
          {
            terminalId: "term-1",
            kind: "shell",
            label: "sh",
            scrollbackContent: "old scrollback bytes",
            shellCwd: "/tmp/x",
          },
        ],
      },
    } as any;
    first.savePaneState(wsPath, legacyTree);
    await first.flush();

    const second = new SessionStateManager(tmpRoot);
    await second.load();
    const extracted = second.extractInlineScrollback();

    expect(extracted.size).toBe(1);
    expect(extracted.get("term-1")).toEqual({
      scrollback: "old scrollback bytes",
      cwd: "/tmp/x",
    });
    // Tree no longer carries the inline field.
    const cleaned = second.getPaneState(wsPath) as any;
    expect(cleaned.pane.tabs[0].scrollbackContent).toBeUndefined();
    expect(cleaned.pane.tabs[0].shellCwd).toBe("/tmp/x");
  });

  it("collectLiveTerminalIds walks splits and leaves", async () => {
    const wsPath = join(tmpRoot, "ws-multi");
    mkdirSync(wsPath, { recursive: true });

    const mgr = new SessionStateManager(tmpRoot);
    mgr.savePaneState(wsPath, {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "leaf",
          pane: { tabs: [{ terminalId: "a", kind: "shell" }] },
        },
        {
          type: "leaf",
          pane: { tabs: [{ terminalId: "b", kind: "claude" }, { kind: "note" }] },
        },
      ],
    } as any);

    const ids = mgr.collectLiveTerminalIds();
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("keeps state dirty when a flush fails so a later flush can retry", async () => {
    const blockedPath = join(tmpRoot, "not-a-directory");
    writeFileSync(blockedPath, "x");

    const manager = new SessionStateManager(blockedPath);
    manager.setRepoCollapsed("repo-a", true);

    expect((manager as any).dirty).toBe(true);
    await manager.flush();
    expect((manager as any).dirty).toBe(true);
  });
});
