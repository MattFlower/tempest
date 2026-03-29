// ============================================================
// PaneNode — Immutable recursive tree for pane layout.
// Port of Tempest/Models/PaneNode.swift.
// All operations return new trees (never mutate in place).
// Full implementation in Stream B.
// ============================================================

import { PaneTabKind, type ActivityState } from "../../../shared/ipc-types";

export interface PaneTab {
  id: string;
  kind: PaneTabKind;
  label: string;
  terminalId?: string; // Links to PTY instance
  browserURL?: string;
  sessionId?: string; // Claude session ID
  isAlive: boolean;
  processId?: number;
  activityState?: ActivityState;
  markdownFilePath?: string;
  editorFilePath?: string;
}

export interface Pane {
  id: string;
  tabs: PaneTab[];
  selectedTabId?: string;
}

export type PaneNode =
  | { type: "leaf"; pane: Pane }
  | { type: "split"; id: string; children: PaneNode[]; ratios: number[] };

// --- Factory helpers ---

export function createPane(tab?: PaneTab): Pane {
  const id = crypto.randomUUID();
  return {
    id,
    tabs: tab ? [tab] : [],
    selectedTabId: tab?.id,
  };
}

export function createTab(
  kind: PaneTabKind,
  label: string,
  overrides?: Partial<PaneTab>,
): PaneTab {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    isAlive: true,
    ...overrides,
  };
}

export function createLeaf(pane: Pane): PaneNode {
  return { type: "leaf", pane };
}

// --- Serialization (PaneNode ↔ PaneNodeState) ---

import type { PaneNodeState, PaneState, PaneTabState } from "../../../shared/ipc-types";

/** Convert live PaneNode → serializable PaneNodeState for persistence. */
export function toNodeState(node: PaneNode): PaneNodeState {
  if (node.type === "leaf") {
    const pane = node.pane;
    return {
      type: "leaf",
      pane: {
        tabs: pane.tabs.map((tab) => ({
          kind: tab.kind,
          label: tab.label,
          sessionId: tab.sessionId,
          browserURL: tab.browserUrl,
          markdownFilePath: tab.markdownFilePath,
          editorFilePath: tab.editorFilePath,
        })),
        selectedTabIndex: Math.max(
          0,
          pane.tabs.findIndex((t) => t.id === pane.selectedTabId),
        ),
      },
    };
  }
  return {
    type: "split",
    children: node.children.map(toNodeState),
    ratios: node.ratios,
  };
}

/** Convert serialized PaneNodeState → live PaneNode (assigns new IDs + terminalIds). */
export function fromNodeState(state: PaneNodeState): PaneNode {
  if (state.type === "leaf") {
    const ps = state.pane;
    const tabs: PaneTab[] = ps.tabs.map((ts: any) => ({
      id: crypto.randomUUID(),
      kind: ts.kind,
      label: ts.label,
      isAlive: true,
      // Handle both Swift's "sessionID" and our "sessionId"
      sessionId: ts.sessionId ?? ts.sessionID,
      browserUrl: ts.browserURL ?? ts.browserUrl,
      markdownFilePath: ts.markdownFilePath,
      editorFilePath: ts.editorFilePath,
      // Terminal/Claude tabs get fresh terminalIds so new PTYs are created
      terminalId:
        ts.kind === PaneTabKind.Claude || ts.kind === PaneTabKind.Shell
          ? crypto.randomUUID()
          : undefined,
    }));
    const selectedTab = tabs[ps.selectedTabIndex] ?? tabs[0];
    return {
      type: "leaf",
      pane: {
        id: crypto.randomUUID(),
        tabs,
        selectedTabId: selectedTab?.id,
      },
    };
  }
  return {
    type: "split",
    id: crypto.randomUUID(),
    children: state.children.map(fromNodeState),
    ratios: state.ratios,
  };
}

export function createSplit(
  children: PaneNode[],
  ratios?: number[],
): PaneNode {
  const n = children.length;
  return {
    type: "split",
    id: crypto.randomUUID(),
    children,
    ratios: ratios ?? Array(n).fill(1 / n),
  };
}

// --- Tree query helpers ---

export function allPanes(node: PaneNode): Pane[] {
  if (node.type === "leaf") return [node.pane];
  return node.children.flatMap(allPanes);
}

export function findPane(node: PaneNode, paneId: string): Pane | undefined {
  if (node.type === "leaf") {
    return node.pane.id === paneId ? node.pane : undefined;
  }
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return undefined;
}

export function findPaneByTabId(
  node: PaneNode,
  tabId: string,
): Pane | undefined {
  if (node.type === "leaf") {
    return node.pane.tabs.some((t) => t.id === tabId) ? node.pane : undefined;
  }
  for (const child of node.children) {
    const found = findPaneByTabId(child, tabId);
    if (found) return found;
  }
  return undefined;
}

// --- Tree mutations (immutable — all return new trees) ---

export function addingPane(
  root: PaneNode,
  newPane: Pane,
  afterPaneId: string,
): PaneNode {
  if (root.type === "leaf") {
    if (root.pane.id === afterPaneId) {
      return {
        type: "split",
        id: crypto.randomUUID(),
        children: [root, { type: "leaf", pane: newPane }],
        ratios: [0.5, 0.5],
      };
    }
    return root;
  }

  // Check direct children for a leaf matching afterPaneId
  const directIndex = root.children.findIndex(
    (child) => child.type === "leaf" && child.pane.id === afterPaneId,
  );

  if (directIndex !== -1) {
    const newChildren = [...root.children];
    newChildren.splice(directIndex + 1, 0, { type: "leaf", pane: newPane });
    const n = newChildren.length;
    return {
      type: "split",
      id: root.id,
      children: newChildren,
      ratios: Array(n).fill(1 / n),
    };
  }

  // Recurse into children
  const updatedChildren = root.children.map((child) =>
    addingPane(child, newPane, afterPaneId),
  );
  const changed = updatedChildren.some(
    (child, i) => child !== root.children[i],
  );
  if (!changed) return root;

  return {
    type: "split",
    id: root.id,
    children: updatedChildren,
    ratios: root.ratios,
  };
}

export function addingPaneBefore(
  root: PaneNode,
  newPane: Pane,
  beforePaneId: string,
): PaneNode {
  if (root.type === "leaf") {
    if (root.pane.id === beforePaneId) {
      return {
        type: "split",
        id: crypto.randomUUID(),
        children: [{ type: "leaf", pane: newPane }, root],
        ratios: [0.5, 0.5],
      };
    }
    return root;
  }

  // Check direct children for a leaf matching beforePaneId
  const directIndex = root.children.findIndex(
    (child) => child.type === "leaf" && child.pane.id === beforePaneId,
  );

  if (directIndex !== -1) {
    const newChildren = [...root.children];
    newChildren.splice(directIndex, 0, { type: "leaf", pane: newPane });
    const n = newChildren.length;
    return {
      type: "split",
      id: root.id,
      children: newChildren,
      ratios: Array(n).fill(1 / n),
    };
  }

  // Recurse into children
  const updatedChildren = root.children.map((child) =>
    addingPaneBefore(child, newPane, beforePaneId),
  );
  const changed = updatedChildren.some(
    (child, i) => child !== root.children[i],
  );
  if (!changed) return root;

  return {
    type: "split",
    id: root.id,
    children: updatedChildren,
    ratios: root.ratios,
  };
}

export function removingPane(
  root: PaneNode,
  paneId: string,
): PaneNode | null {
  if (root.type === "leaf") {
    return root.pane.id === paneId ? null : root;
  }

  const filtered: PaneNode[] = [];
  for (const child of root.children) {
    const result = removingPane(child, paneId);
    if (result !== null) filtered.push(result);
  }

  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0]!; // collapse single child

  const n = filtered.length;
  return {
    type: "split",
    id: root.id,
    children: filtered,
    ratios: Array(n).fill(1 / n),
  };
}

export function updatingPane(
  root: PaneNode,
  paneId: string,
  transform: (pane: Pane) => Pane,
): PaneNode {
  if (root.type === "leaf") {
    if (root.pane.id === paneId) {
      return { type: "leaf", pane: transform(root.pane) };
    }
    return root;
  }

  const updatedChildren = root.children.map((child) =>
    updatingPane(child, paneId, transform),
  );
  const changed = updatedChildren.some(
    (child, i) => child !== root.children[i],
  );
  if (!changed) return root;

  return {
    type: "split",
    id: root.id,
    children: updatedChildren,
    ratios: root.ratios,
  };
}

export function movingTab(
  root: PaneNode,
  tabId: string,
  fromPaneId: string,
  toPaneId: string,
  atIndex?: number,
): PaneNode {
  const sourcePane = findPane(root, fromPaneId);
  if (!sourcePane) return root;

  const tab = sourcePane.tabs.find((t) => t.id === tabId);
  if (!tab) return root;

  // Same-pane reorder
  if (fromPaneId === toPaneId) {
    return updatingPane(root, fromPaneId, (pane) => {
      const currentIndex = pane.tabs.findIndex((t) => t.id === tabId);
      if (currentIndex === -1) return pane;
      const withoutTab = [
        ...pane.tabs.slice(0, currentIndex),
        ...pane.tabs.slice(currentIndex + 1),
      ];
      const insertIdx = Math.min(atIndex ?? withoutTab.length, withoutTab.length);
      const newTabs = [
        ...withoutTab.slice(0, insertIdx),
        tab,
        ...withoutTab.slice(insertIdx),
      ];
      return { ...pane, tabs: newTabs, selectedTabId: tabId };
    });
  }

  // Cross-pane: add to destination first
  let result = updatingPane(root, toPaneId, (pane) => {
    const insertIdx = Math.min(atIndex ?? pane.tabs.length, pane.tabs.length);
    const newTabs = [
      ...pane.tabs.slice(0, insertIdx),
      tab,
      ...pane.tabs.slice(insertIdx),
    ];
    return { ...pane, tabs: newTabs, selectedTabId: tabId };
  });

  // Then remove from source
  if (sourcePane.tabs.length <= 1) {
    const removed = removingPane(result, fromPaneId);
    result = removed ?? result;
  } else {
    result = updatingPane(result, fromPaneId, (pane) => {
      const newTabs = pane.tabs.filter((t) => t.id !== tabId);
      const newSelectedTabId =
        pane.selectedTabId === tabId
          ? newTabs[newTabs.length - 1]?.id
          : pane.selectedTabId;
      return { ...pane, tabs: newTabs, selectedTabId: newSelectedTabId };
    });
  }

  return result;
}

export function withRatios(
  root: PaneNode,
  splitId: string,
  newRatios: number[],
): PaneNode {
  if (root.type === "leaf") return root;

  if (root.id === splitId) {
    return {
      type: "split",
      id: root.id,
      children: root.children,
      ratios: newRatios,
    };
  }

  const updatedChildren = root.children.map((child) =>
    withRatios(child, splitId, newRatios),
  );
  const changed = updatedChildren.some(
    (child, i) => child !== root.children[i],
  );
  if (!changed) return root;

  return {
    type: "split",
    id: root.id,
    children: updatedChildren,
    ratios: root.ratios,
  };
}
