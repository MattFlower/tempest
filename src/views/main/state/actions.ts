// ============================================================
// Pane actions — high-level operations that read/write the Zustand
// store and transform the pane tree using immutable helpers.
// ============================================================

import { PaneTabKind, ProgressState } from "../../../shared/ipc-types";
import {
  type PaneNode,
  type Pane,
  type PaneTab,
  createPane,
  createTab,
  createLeaf,
  allPanes,
  findPane,
  addingPane,
  addingPaneBefore,
  removingPane,
  updatingPane,
  movingTab,
  withRatios,
  toNodeState,
} from "../models/pane-node";
import { useStore } from "./store";
import { api } from "./rpc-client";
import { queueTerminalInput } from "./pending-terminal-input";
import { markTerminalMoving } from "./terminal-registry";

// --- Helpers ---

function currentTree(): { workspacePath: string; tree: PaneNode } | null {
  const { selectedWorkspacePath, paneTrees } = useStore.getState();
  if (!selectedWorkspacePath) return null;
  const tree = paneTrees[selectedWorkspacePath];
  if (!tree) return null;
  return { workspacePath: selectedWorkspacePath, tree };
}

function commitTree(workspacePath: string, tree: PaneNode) {
  useStore.getState().setPaneTree(workspacePath, tree);
  api.notifyPaneTreeChanged(workspacePath, toNodeState(tree));
}

// --- Tab Actions ---

export function selectTab(paneId: string, tabId: string) {
  const ctx = currentTree();
  if (!ctx) return;

  const newTree = updatingPane(ctx.tree, paneId, (pane) => ({
    ...pane,
    selectedTabId: tabId,
  }));
  commitTree(ctx.workspacePath, newTree);
  useStore.getState().setFocusedPaneId(paneId);
}

export function addTab(paneId: string, tab: PaneTab) {
  const ctx = currentTree();
  if (!ctx) return;

  const newTree = updatingPane(ctx.tree, paneId, (pane) => ({
    ...pane,
    tabs: [...pane.tabs, tab],
    selectedTabId: tab.id,
  }));
  commitTree(ctx.workspacePath, newTree);
  useStore.getState().setFocusedPaneId(paneId);
}

export function closeTab(paneId: string, tabId: string) {
  const ctx = currentTree();
  if (!ctx) return;

  const pane = findPane(ctx.tree, paneId);
  if (!pane) return;

  if (pane.tabs.length <= 1) {
    // Last tab — remove entire pane
    const newTree = removingPane(ctx.tree, paneId);
    if (newTree) {
      commitTree(ctx.workspacePath, newTree);
      // Move focus to first remaining pane
      const remaining = allPanes(newTree);
      useStore.getState().setFocusedPaneId(remaining[0]?.id ?? null);
    } else {
      // Tree is empty — clear it
      const { selectedWorkspacePath, setFocusedPaneId, setMaximizedPaneId } =
        useStore.getState();
      if (selectedWorkspacePath) {
        // Create a fresh default pane
        const tab = createTab(PaneTabKind.Claude, "Claude", {
          terminalId: crypto.randomUUID(),
        });
        const newPane = createPane(tab);
        const tree = createLeaf(newPane);
        commitTree(selectedWorkspacePath, tree);
        setFocusedPaneId(newPane.id);
        setMaximizedPaneId(null);
      }
    }
    // Clear maximize if the maximized pane was removed
    const { maximizedPaneId } = useStore.getState();
    if (maximizedPaneId === paneId) {
      useStore.getState().setMaximizedPaneId(null);
    }
    return;
  }

  // Not the last tab — remove tab and update selection
  const tabIndex = pane.tabs.findIndex((t) => t.id === tabId);
  const newTree = updatingPane(ctx.tree, paneId, (p) => {
    const newTabs = p.tabs.filter((t) => t.id !== tabId);
    let newSelectedTabId = p.selectedTabId;
    if (p.selectedTabId === tabId) {
      // Select the tab to the left, or the first tab
      const newIdx = Math.max(0, tabIndex - 1);
      newSelectedTabId = newTabs[newIdx]?.id;
    }
    return { ...p, tabs: newTabs, selectedTabId: newSelectedTabId };
  });
  commitTree(ctx.workspacePath, newTree);
}

export function moveTab(
  tabId: string,
  fromPaneId: string,
  toPaneId: string,
  atIndex?: number,
) {
  const ctx = currentTree();
  if (!ctx) return;

  // Tell the TerminalPane (if this tab owns one) that its upcoming unmount
  // cleanup — if React re-parents instead of reusing the instance — is a move,
  // not a close, so it must not kill the PTY.
  const sourcePane = findPane(ctx.tree, fromPaneId);
  const movingTerminalId = sourcePane?.tabs.find((t) => t.id === tabId)?.terminalId;
  if (movingTerminalId) markTerminalMoving(movingTerminalId);

  const newTree = movingTab(ctx.tree, tabId, fromPaneId, toPaneId, atIndex);
  commitTree(ctx.workspacePath, newTree);
  useStore.getState().setFocusedPaneId(toPaneId);

  // Clear maximize if source pane was removed
  const { maximizedPaneId } = useStore.getState();
  if (maximizedPaneId && !findPane(newTree, maximizedPaneId)) {
    useStore.getState().setMaximizedPaneId(null);
  }
}

export function moveTabToNewPane(
  tabId: string,
  fromPaneId: string,
  targetPaneId: string,
  direction: "left" | "right",
) {
  const ctx = currentTree();
  if (!ctx) return;

  const sourcePane = findPane(ctx.tree, fromPaneId);
  if (!sourcePane) return;

  const tab = sourcePane.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  // See moveTab: mark the terminal as "being moved" so the TerminalPane
  // cleanup (which may run before Zustand re-renders) does not kill the PTY.
  if (tab.terminalId) markTerminalMoving(tab.terminalId);

  // Create new pane containing just this tab
  const newPane = createPane(tab);

  // Remove tab from source pane (or remove entire pane if last tab)
  let tree = ctx.tree;
  if (sourcePane.tabs.length <= 1) {
    const removed = removingPane(tree, fromPaneId);
    if (!removed) return;
    tree = removed;
  } else {
    tree = updatingPane(tree, fromPaneId, (pane) => {
      const newTabs = pane.tabs.filter((t) => t.id !== tabId);
      const newSelectedTabId =
        pane.selectedTabId === tabId
          ? newTabs[newTabs.length - 1]?.id
          : pane.selectedTabId;
      return { ...pane, tabs: newTabs, selectedTabId: newSelectedTabId };
    });
  }

  // Insert new pane adjacent to target
  if (direction === "right") {
    tree = addingPane(tree, newPane, targetPaneId);
  } else {
    tree = addingPaneBefore(tree, newPane, targetPaneId);
  }

  commitTree(ctx.workspacePath, tree);
  useStore.getState().setFocusedPaneId(newPane.id);

  const { maximizedPaneId } = useStore.getState();
  if (maximizedPaneId && !findPane(tree, maximizedPaneId)) {
    useStore.getState().setMaximizedPaneId(null);
  }
}

// --- Terminal-driven tab updates ---

export function updateTabLabelByTerminalId(terminalId: string, label: string) {
  const ctx = currentTree();
  if (!ctx) return;

  const panes = allPanes(ctx.tree);
  for (const pane of panes) {
    const tab = pane.tabs.find((t) => t.terminalId === terminalId);
    if (tab) {
      const newTree = updatingPane(ctx.tree, pane.id, (p) => ({
        ...p,
        tabs: p.tabs.map((t) =>
          t.id === tab.id ? { ...t, label } : t,
        ),
      }));
      commitTree(ctx.workspacePath, newTree);
      return;
    }
  }
}

export function updateTabCwdByTerminalId(terminalId: string, cwd: string) {
  const ctx = currentTree();
  if (!ctx) return;

  const panes = allPanes(ctx.tree);
  for (const pane of panes) {
    const tab = pane.tabs.find((t) => t.terminalId === terminalId);
    if (tab) {
      const newTree = updatingPane(ctx.tree, pane.id, (p) => ({
        ...p,
        tabs: p.tabs.map((t) =>
          t.id === tab.id ? { ...t, shellCwd: cwd } : t,
        ),
      }));
      commitTree(ctx.workspacePath, newTree);
      return;
    }
  }
}

export function updateTabProgressByTerminalId(
  terminalId: string,
  state: 0 | 1 | 2 | 3 | 4,
  value: number,
) {
  const ctx = currentTree();
  if (!ctx) return;

  const progressState = state === ProgressState.None ? undefined : (state as ProgressState);
  const progressValue = state === ProgressState.None ? undefined : value;

  const panes = allPanes(ctx.tree);
  for (const pane of panes) {
    const tab = pane.tabs.find((t) => t.terminalId === terminalId);
    if (tab) {
      const newTree = updatingPane(ctx.tree, pane.id, (p) => ({
        ...p,
        tabs: p.tabs.map((t) =>
          t.id === tab.id ? { ...t, progressState, progressValue } : t,
        ),
      }));
      commitTree(ctx.workspacePath, newTree);
      return;
    }
  }
}

// --- Split / Pane Actions ---

export function splitPane(direction: "right" | "left" = "right", emptyPane = false) {
  const ctx = currentTree();
  if (!ctx) return;

  const { focusedPaneId } = useStore.getState();
  if (!focusedPaneId) return;

  let newPane;
  if (emptyPane) {
    newPane = createPane();
  } else {
    const tab = createTab(PaneTabKind.Shell, "Shell", {
      terminalId: crypto.randomUUID(),
    });
    newPane = createPane(tab);
  }

  let newTree: PaneNode;
  if (direction === "right") {
    newTree = addingPane(ctx.tree, newPane, focusedPaneId);
  } else {
    newTree = addingPaneBefore(ctx.tree, newPane, focusedPaneId);
  }

  commitTree(ctx.workspacePath, newTree);
  useStore.getState().setFocusedPaneId(newPane.id);
  useStore.getState().setMaximizedPaneId(null);
}

// --- Focus Navigation ---

export function focusNextPane() {
  const ctx = currentTree();
  if (!ctx) return;
  const { maximizedPaneId } = useStore.getState();
  if (maximizedPaneId) return; // disabled in maximize mode

  const panes = allPanes(ctx.tree);
  if (panes.length === 0) return;

  const { focusedPaneId } = useStore.getState();
  const idx = panes.findIndex((p) => p.id === focusedPaneId);
  const nextIdx = (idx + 1) % panes.length;
  useStore.getState().setFocusedPaneId(panes[nextIdx]!.id);
}

export function focusPreviousPane() {
  const ctx = currentTree();
  if (!ctx) return;
  const { maximizedPaneId } = useStore.getState();
  if (maximizedPaneId) return;

  const panes = allPanes(ctx.tree);
  if (panes.length === 0) return;

  const { focusedPaneId } = useStore.getState();
  const idx = panes.findIndex((p) => p.id === focusedPaneId);
  const prevIdx = (idx - 1 + panes.length) % panes.length;
  useStore.getState().setFocusedPaneId(panes[prevIdx]!.id);
}

// --- Maximize ---

export function toggleMaximize() {
  const { focusedPaneId, maximizedPaneId, setMaximizedPaneId } =
    useStore.getState();
  if (maximizedPaneId) {
    setMaximizedPaneId(null);
  } else if (focusedPaneId) {
    setMaximizedPaneId(focusedPaneId);
  }
}

// --- Divider Drag / Resize ---

const MIN_RATIO = 0.05;

export function handleDividerDrag(
  splitId: string,
  index: number,
  deltaRatio: number,
) {
  const ctx = currentTree();
  if (!ctx) return;

  // Find the split node to get current ratios
  const split = findSplit(ctx.tree, splitId);
  if (!split) return;

  const ratios = [...split.ratios];
  let left = (ratios[index] ?? 0) + deltaRatio;
  let right = (ratios[index + 1] ?? 0) - deltaRatio;

  // Clamp
  if (left < MIN_RATIO) {
    right -= MIN_RATIO - left;
    left = MIN_RATIO;
  }
  if (right < MIN_RATIO) {
    left -= MIN_RATIO - right;
    right = MIN_RATIO;
  }

  ratios[index] = left;
  ratios[index + 1] = right;

  const newTree = withRatios(ctx.tree, splitId, ratios);
  commitTree(ctx.workspacePath, newTree);
}

export function resetRatios() {
  const ctx = currentTree();
  if (!ctx) return;
  if (ctx.tree.type !== "split") return;

  const n = ctx.tree.children.length;
  const newTree = withRatios(
    ctx.tree,
    ctx.tree.id,
    Array(n).fill(1 / n),
  );
  commitTree(ctx.workspacePath, newTree);
}

// --- Helpers ---

function findSplit(
  node: PaneNode,
  splitId: string,
): Extract<PaneNode, { type: "split" }> | undefined {
  if (node.type === "leaf") return undefined;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found) return found;
  }
  return undefined;
}

export function containsPane(node: PaneNode, paneId: string): boolean {
  if (node.type === "leaf") return node.pane.id === paneId;
  return node.children.some((child) => containsPane(child, paneId));
}

// --- Resume a historical session in a new tab ---

/**
 * Open a new Claude or Pi tab pre-populated with a session from the
 * Chat History viewer. For Claude, `sessionRef` is the .jsonl filename
 * sans extension (the session UUID). For Pi, `sessionRef` is the
 * absolute path to the .jsonl transcript — `buildPiCommand` consumes
 * it via `--session <path>`.
 */
export function resumeSessionInNewTab(
  provider: "claude" | "pi",
  sessionRef: string,
) {
  const ctx = currentTree();
  if (!ctx) return;

  const { focusedPaneId } = useStore.getState();
  const panes = allPanes(ctx.tree);
  const targetPaneId = focusedPaneId ?? panes[0]?.id;
  if (!targetPaneId) return;

  const terminalId = crypto.randomUUID();
  const newTab =
    provider === "claude"
      ? createTab(PaneTabKind.Claude, "Claude", {
          terminalId,
          resume: true,
          sessionId: sessionRef,
        })
      : createTab(PaneTabKind.Pi, "Pi", {
          terminalId,
          sessionId: sessionRef,
        });

  addTab(targetPaneId, newTab);
}

// --- Ask Claude about selection ---

export function askClaudeAboutSelection(selectedText: string, filePath: string, sourceLine?: number | null) {
  const ctx = currentTree();
  if (!ctx) return;

  const { focusedPaneId } = useStore.getState();

  // Format prompt — use bracketed paste for multi-line support, then \r to submit
  const fileName = filePath.split("/").pop() ?? filePath;
  const lineRef = sourceLine ? ` (line ${sourceLine})` : "";
  const prompt = `Regarding this excerpt from \`${fileName}\`${lineRef}:\n\n"""\n${selectedText}\n"""\n\n`;
  const terminalInput = `\x1b[200~${prompt}\x1b[201~\r`;

  // Find the first alive Claude tab in the workspace
  const panes = allPanes(ctx.tree);
  for (const pane of panes) {
    for (const tab of pane.tabs) {
      if (tab.kind === PaneTabKind.Claude && tab.isAlive && tab.terminalId) {
        // Write to existing session and focus it
        api.writeToTerminal(tab.terminalId, terminalInput);
        selectTab(pane.id, tab.id);
        return;
      }
    }
  }

  // No Claude session — create one with continue mode (claude -c)
  const terminalId = crypto.randomUUID();
  const newTab = createTab(PaneTabKind.Claude, "Claude", {
    terminalId,
    resume: true,
  });

  queueTerminalInput(terminalId, terminalInput);

  const targetPaneId = focusedPaneId ?? panes[0]?.id;
  if (targetPaneId) {
    addTab(targetPaneId, newTab);
  }
}
