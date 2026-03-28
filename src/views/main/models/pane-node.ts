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
  browserUrl?: string;
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

// --- Tree mutation stubs (implemented in Stream B) ---

export function addingPane(
  _root: PaneNode,
  _newPane: Pane,
  _afterPaneId: string,
): PaneNode {
  // Stream B implements this
  throw new Error("Not implemented — Stream B");
}

export function removingPane(
  _root: PaneNode,
  _paneId: string,
): PaneNode | null {
  // Stream B implements this
  throw new Error("Not implemented — Stream B");
}

export function updatingPane(
  _root: PaneNode,
  _paneId: string,
  _transform: (pane: Pane) => Pane,
): PaneNode {
  // Stream B implements this
  throw new Error("Not implemented — Stream B");
}

export function movingTab(
  _root: PaneNode,
  _tabId: string,
  _fromPaneId: string,
  _toPaneId: string,
  _atIndex?: number,
): PaneNode {
  // Stream B implements this
  throw new Error("Not implemented — Stream B");
}

export function withRatios(
  _root: PaneNode,
  _splitId: string,
  _newRatios: number[],
): PaneNode {
  // Stream B implements this
  throw new Error("Not implemented — Stream B");
}
