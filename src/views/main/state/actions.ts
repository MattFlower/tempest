// ============================================================
// Pane actions — high-level operations that read/write the Zustand
// store and transform the pane tree using immutable helpers.
// ============================================================

import { PaneTabKind } from "../../../shared/ipc-types";
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
      const { selectedWorkspacePath, setPaneTree, setFocusedPaneId, setMaximizedPaneId } =
        useStore.getState();
      if (selectedWorkspacePath) {
        // Create a fresh default pane
        const tab = createTab(PaneTabKind.Shell, "Shell", {
          terminalId: crypto.randomUUID(),
        });
        const newPane = createPane(tab);
        const tree = createLeaf(newPane);
        setPaneTree(selectedWorkspacePath, tree);
        setFocusedPaneId(newPane.id);
        setMaximizedPaneId(null);
        api.notifyPaneTreeChanged(selectedWorkspacePath, tree);
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

  const newTree = movingTab(ctx.tree, tabId, fromPaneId, toPaneId, atIndex);
  commitTree(ctx.workspacePath, newTree);
  useStore.getState().setFocusedPaneId(toPaneId);

  // Clear maximize if source pane was removed
  const { maximizedPaneId } = useStore.getState();
  if (maximizedPaneId && !findPane(newTree, maximizedPaneId)) {
    useStore.getState().setMaximizedPaneId(null);
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
