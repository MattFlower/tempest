// ============================================================
// Run-pane actions — manage the bottom "Run" pane and its tabs.
// Tabs host PTYs that are spawned via the existing terminal RPC;
// lifecycle (kill on close, restart-via-remount) happens here.
// ============================================================

import { useStore, DEFAULT_RUN_PANE_HEIGHT } from "./store";
import { api } from "./rpc-client";
import type { RunTab, RunTabSource } from "../models/run-tab";

const VISIBLE_KEY_PREFIX = "tempest:runPane:visible:";
const HEIGHT_KEY_PREFIX = "tempest:runPane:height:";

function readVisible(workspacePath: string): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY_PREFIX + workspacePath) === "1";
  } catch {
    return false;
  }
}

function writeVisible(workspacePath: string, visible: boolean): void {
  try {
    localStorage.setItem(VISIBLE_KEY_PREFIX + workspacePath, visible ? "1" : "0");
  } catch {}
}

function readHeight(workspacePath: string): number {
  try {
    const raw = localStorage.getItem(HEIGHT_KEY_PREFIX + workspacePath);
    if (!raw) return DEFAULT_RUN_PANE_HEIGHT;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_RUN_PANE_HEIGHT;
    return n;
  } catch {
    return DEFAULT_RUN_PANE_HEIGHT;
  }
}

function writeHeight(workspacePath: string, height: number): void {
  try {
    localStorage.setItem(HEIGHT_KEY_PREFIX + workspacePath, String(Math.round(height)));
  } catch {}
}

/** Pull persisted visibility + height into the store for this workspace.
 *  Safe to call every time a workspace is opened — no-ops if already hydrated. */
export function hydrateRunPaneForWorkspace(workspacePath: string): void {
  const s = useStore.getState();
  if (s.runPaneVisible[workspacePath] === undefined) {
    s.setRunPaneVisible(workspacePath, readVisible(workspacePath));
  }
  if (s.runPaneHeight[workspacePath] === undefined) {
    s.setRunPaneHeight(workspacePath, readHeight(workspacePath));
  }
}

export function setRunPaneVisible(workspacePath: string, visible: boolean): void {
  useStore.getState().setRunPaneVisible(workspacePath, visible);
  writeVisible(workspacePath, visible);
}

export function toggleRunPane(workspacePath: string): void {
  const current = useStore.getState().runPaneVisible[workspacePath] ?? false;
  setRunPaneVisible(workspacePath, !current);
}

export function setRunPaneHeight(workspacePath: string, height: number): void {
  useStore.getState().setRunPaneHeight(workspacePath, height);
  // Read back the clamped value to persist.
  const clamped = useStore.getState().runPaneHeight[workspacePath] ?? height;
  writeHeight(workspacePath, clamped);
}

function genId(): string {
  return (
    (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function spawnRunTab(
  workspacePath: string,
  source: RunTabSource,
  label: string,
  command: string[],
  cwd: string,
  env: Record<string, string>,
): RunTab {
  const store = useStore.getState();
  const tab: RunTab = {
    id: genId(),
    label,
    source,
    command,
    cwd,
    env,
    terminalId: genId(),
    status: "running",
    startedAt: Date.now(),
  };

  const existing = store.runPaneTabs[workspacePath] ?? [];
  store.setRunPaneTabs(workspacePath, [...existing, tab]);
  store.setRunPaneActiveTabId(workspacePath, tab.id);
  setRunPaneVisible(workspacePath, true);
  return tab;
}

export function selectRunTab(workspacePath: string, tabId: string): void {
  useStore.getState().setRunPaneActiveTabId(workspacePath, tabId);
}

export function closeRunTab(workspacePath: string, tabId: string): void {
  const store = useStore.getState();
  const tabs = store.runPaneTabs[workspacePath] ?? [];
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.status === "running") {
    api.killTerminal({ id: tab.terminalId }).catch(() => {});
  }
  const remaining = tabs.filter((t) => t.id !== tabId);
  store.setRunPaneTabs(workspacePath, remaining);
  const activeId = store.runPaneActiveTabId[workspacePath];
  if (activeId === tabId) {
    const last = remaining[remaining.length - 1];
    store.setRunPaneActiveTabId(workspacePath, last ? last.id : null);
  }
}

export function stopRunTab(workspacePath: string, tabId: string): void {
  const store = useStore.getState();
  const tabs = store.runPaneTabs[workspacePath] ?? [];
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || tab.status !== "running") return;
  api.killTerminal({ id: tab.terminalId }).catch(() => {});
  // Status transition happens via terminalExit handler.
}

export function restartRunTab(workspacePath: string, tabId: string): void {
  const store = useStore.getState();
  const tabs = store.runPaneTabs[workspacePath] ?? [];
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const tab = tabs[idx];
  if (!tab) return;

  if (tab.status === "running") {
    api.killTerminal({ id: tab.terminalId }).catch(() => {});
  }

  // New terminalId forces RunPaneTerminal to unmount/remount (fresh PTY).
  const nextTabs = tabs.slice();
  const nextTab: RunTab = {
    ...tab,
    terminalId: genId(),
    status: "running",
    exitCode: undefined,
    startedAt: Date.now(),
  };
  nextTabs[idx] = nextTab;
  store.setRunPaneTabs(workspacePath, nextTabs);
}

export function markRunTabExited(
  workspacePath: string,
  tabId: string,
  exitCode: number,
): void {
  const store = useStore.getState();
  const tabs = store.runPaneTabs[workspacePath] ?? [];
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const tab = tabs[idx];
  if (!tab) return;
  if (tab.status === "exited" && tab.exitCode === exitCode) return;
  const nextTabs = tabs.slice();
  const nextTab: RunTab = { ...tab, status: "exited", exitCode };
  nextTabs[idx] = nextTab;
  store.setRunPaneTabs(workspacePath, nextTabs);
}

/** Look up (workspacePath, tabId) for a given terminalId across all workspaces. */
export function findRunTabByTerminalId(
  terminalId: string,
): { workspacePath: string; tabId: string } | null {
  const { runPaneTabs } = useStore.getState();
  for (const [workspacePath, tabs] of Object.entries(runPaneTabs)) {
    const match = tabs.find((t) => t.terminalId === terminalId);
    if (match) return { workspacePath, tabId: match.id };
  }
  return null;
}
