import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterSessionStateForKnownWorkspaces,
  SessionStateManager,
} from "./session-state-manager";

const tmpRoot = join("/tmp", `tempest-session-state-test-${Date.now()}`);

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

describe("SessionStateManager repo collapse persistence", () => {
  it("filters restored session state to known workspaces without mutating saved state", () => {
    const knownPath = join(tmpRoot, "known-workspace");
    const unknownPath = join(tmpRoot, "unknown-existing-workspace");
    mkdirSync(knownPath, { recursive: true });
    mkdirSync(unknownPath, { recursive: true });

    const state = {
      version: 1,
      savedAt: "saved-at",
      selectedWorkspacePath: unknownPath,
      hiddenWorkspacePaths: [knownPath, unknownPath],
      fileTree: {
        activeSidebarView: "files",
        expandedRepoIds: ["repo-a"],
        expandedWorkspacePaths: [knownPath, unknownPath],
        expandedDirs: [
          join(knownPath, "src"),
          join(unknownPath, "src"),
        ],
        cursor: `file:${join(unknownPath, "src", "main.ts")}`,
        scrollTop: 40,
        showHidden: true,
        autoReveal: true,
      },
      workspaces: {
        [knownPath]: {
          workspacePath: knownPath,
          paneTree: {
            type: "leaf",
            pane: {
              selectedTabIndex: 0,
              tabs: [{ kind: "shell", label: "known", terminalId: "term-known" }],
            },
          },
        },
        [unknownPath]: {
          workspacePath: unknownPath,
          paneTree: {
            type: "leaf",
            pane: {
              selectedTabIndex: 0,
              tabs: [{ kind: "shell", label: "unknown", terminalId: "term-unknown" }],
            },
          },
        },
      },
    } as any;

    const filtered = filterSessionStateForKnownWorkspaces(state, [knownPath])!;

    expect(Object.keys(filtered.workspaces)).toEqual([knownPath]);
    expect(filtered.workspaces[knownPath]?.paneTree).toEqual(state.workspaces[knownPath].paneTree);
    expect(filtered.workspaces[unknownPath]).toBeUndefined();
    expect(filtered.selectedWorkspacePath).toBeUndefined();
    expect(filtered.hiddenWorkspacePaths).toEqual([knownPath]);
    expect(filtered.fileTree).toEqual({
      activeSidebarView: "files",
      expandedRepoIds: ["repo-a"],
      expandedWorkspacePaths: [knownPath],
      expandedDirs: [join(knownPath, "src")],
      cursor: null,
      scrollTop: 40,
      showHidden: true,
      autoReveal: true,
    });

    (filtered.workspaces[knownPath]!.paneTree as any).pane.tabs[0].label = "changed";
    expect(state.workspaces[knownPath].paneTree.pane.tabs[0].label).toBe("known");
    expect(state.workspaces[unknownPath]).toBeDefined();
  });

  it("keeps a selected workspace when it is known", () => {
    const wsPath = join(tmpRoot, "selected-known-workspace");
    const state = {
      version: 1,
      savedAt: "saved-at",
      selectedWorkspacePath: wsPath,
      workspaces: {
        [wsPath]: {
          workspacePath: wsPath,
          paneTree: {
            type: "leaf",
            pane: {
              selectedTabIndex: 0,
              tabs: [{ kind: "shell", label: "known", terminalId: "term-known" }],
            },
          },
        },
      },
    } as any;

    const filtered = filterSessionStateForKnownWorkspaces(state, [wsPath]);

    expect(filtered?.selectedWorkspacePath).toBe(wsPath);
    expect(Object.keys(filtered?.workspaces ?? {})).toEqual([wsPath]);
  });

  it("keeps file-tree cursors under known workspaces", () => {
    const wsPath = join(tmpRoot, "file-tree-known-workspace");
    const filePath = join(wsPath, "src", "main.ts");
    const state = {
      version: 1,
      savedAt: "saved-at",
      workspaces: {},
      fileTree: {
        expandedWorkspacePaths: [wsPath],
        expandedDirs: [join(wsPath, "src")],
        cursor: `file:${filePath}`,
      },
    } as any;

    const filtered = filterSessionStateForKnownWorkspaces(state, [wsPath]);

    expect(filtered?.fileTree?.expandedWorkspacePaths).toEqual([wsPath]);
    expect(filtered?.fileTree?.expandedDirs).toEqual([join(wsPath, "src")]);
    expect(filtered?.fileTree?.cursor).toBe(`file:${filePath}`);
  });

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

  it("persists hidden workspace paths and migrates them on rename", async () => {
    const oldPath = join(tmpRoot, "old-workspace");
    const newPath = join(tmpRoot, "new-workspace");
    mkdirSync(oldPath, { recursive: true });

    const first = new SessionStateManager(tmpRoot);
    first.setWorkspaceHidden(oldPath, true);
    await first.flush();

    const second = new SessionStateManager(tmpRoot);
    const loaded = await second.load();
    expect(loaded?.hiddenWorkspacePaths).toEqual([oldPath]);

    second.migrateWorkspacePath(oldPath, newPath);
    mkdirSync(newPath, { recursive: true });
    await second.flush();

    const third = new SessionStateManager(tmpRoot);
    const migrated = await third.load();
    expect(migrated?.hiddenWorkspacePaths).toEqual([newPath]);
  });

  it("drops hidden workspace paths whose directories are gone", async () => {
    const existingPath = join(tmpRoot, "existing-workspace");
    const missingPath = join(tmpRoot, "missing-workspace");
    mkdirSync(existingPath, { recursive: true });

    const first = new SessionStateManager(tmpRoot);
    first.setWorkspaceHidden(existingPath, true);
    first.setWorkspaceHidden(missingPath, true);
    await first.flush();

    const second = new SessionStateManager(tmpRoot);
    const loaded = await second.load();

    expect(loaded?.hiddenWorkspacePaths).toEqual([existingPath]);
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
