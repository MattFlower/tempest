import { useMemo, useCallback } from "react";
import { PaneTabKind, ViewMode, WorkspaceStatus, ActivityState } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { addTab, splitPane } from "../../state/actions";
import { api } from "../../state/rpc-client";
import { DropdownButton, type DropdownItem } from "./DropdownButton";
import { StatusBadge } from "./StatusBadge";

interface WorkspaceToolbarProps {
  workspacePath: string;
}

function addTabToFocusedPane(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  const { focusedPaneId } = useStore.getState();
  if (!focusedPaneId) return;
  const tab = createTab(kind, label, {
    ...(kind === PaneTabKind.Claude || kind === PaneTabKind.Shell
      ? { terminalId: crypto.randomUUID() }
      : {}),
    ...(kind === PaneTabKind.Browser ? { browserURL: "https://google.com" } : {}),
    ...overrides,
  });
  addTab(focusedPaneId, tab);
}

function splitWithTab(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  splitPane("right", true);
  setTimeout(() => addTabToFocusedPane(kind, label, overrides), 0);
}

// PR icon (git pull request / arrow.triangle.pull equivalent)
const PRIcon = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="3.5" r="2" />
    <circle cx="5" cy="12.5" r="2" />
    <circle cx="11" cy="12.5" r="2" />
    <path d="M5 5.5v5" />
    <path d="M11 5.5v5" />
    <path d="M11 5.5c0-1.5-1-2-2-2H7" />
    <path d="M8.5 2L7 3.5 8.5 5" />
  </svg>
);

export function WorkspaceToolbar({ workspacePath }: WorkspaceToolbarProps) {
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);
  const activity = useStore((s) => s.workspaceActivity[workspacePath]);

  // Find workspace object to get name and status
  const workspace = useMemo(() => {
    for (const workspaces of Object.values(workspacesByRepo)) {
      const found = workspaces.find((ws) => ws.path === workspacePath);
      if (found) return found;
    }
    return null;
  }, [workspacesByRepo, workspacePath]);

  // Derive effective status (activity overrides workspace.status)
  let effectiveStatus = workspace?.status ?? WorkspaceStatus.Idle;
  if (activity === ActivityState.Working) effectiveStatus = WorkspaceStatus.Working;
  else if (activity === ActivityState.NeedsInput) effectiveStatus = WorkspaceStatus.NeedsInput;
  else if (activity === ActivityState.Idle) effectiveStatus = WorkspaceStatus.Idle;

  const workspaceName = workspace?.name ?? workspacePath.split("/").pop() ?? "Workspace";

  const handleViewPRInBrowser = useCallback(async () => {
    try {
      const result = await api.lookupPRUrl(workspacePath);
      if ("error" in result) {
        console.warn("[WorkspaceToolbar] View PR failed:", result.error);
        return;
      }
      addTabToFocusedPane(PaneTabKind.Browser, "PR", { browserURL: result.url });
    } catch (err) {
      console.error("[WorkspaceToolbar] View PR error:", err);
    }
  }, [workspacePath]);

  const newItems: DropdownItem[] = [
    { label: "Terminal", action: () => addTabToFocusedPane(PaneTabKind.Shell, "Shell") },
    { label: "Claude", action: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude") },
    { label: "Claude (Continue)", action: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude", { resume: true }) },
    { label: "Browser", action: () => addTabToFocusedPane(PaneTabKind.Browser, "Browser") },
    { label: "Chat History", action: () => addTabToFocusedPane(PaneTabKind.HistoryViewer, "History") },
  ];

  const splitItems: DropdownItem[] = [
    { label: "Terminal", action: () => splitWithTab(PaneTabKind.Shell, "Shell") },
    { label: "Claude", action: () => splitWithTab(PaneTabKind.Claude, "Claude") },
    { label: "Claude (Continue)", action: () => splitWithTab(PaneTabKind.Claude, "Claude", { resume: true }) },
    { label: "Browser", action: () => splitWithTab(PaneTabKind.Browser, "Browser") },
    { label: "Chat History", action: () => splitWithTab(PaneTabKind.HistoryViewer, "History") },
  ];

  const prItems: DropdownItem[] = [
    { label: "Open PR", action: () => console.log("[TODO] Open PR") },
    { label: "Link PR", action: () => console.log("[TODO] Link PR") },
    { label: "View PR in Browser", action: handleViewPRInBrowser },
    { label: "PR Review", action: () => useStore.getState().setViewMode(workspacePath, ViewMode.Dashboard) },
  ];

  return (
    <div
      className="flex items-center px-4 py-1.5 flex-shrink-0 border-b border-[var(--ctp-surface0)]"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <span className="text-sm font-semibold text-[var(--ctp-text)] mr-2">
        {workspaceName}
      </span>
      <StatusBadge status={effectiveStatus} />

      <span className="flex-1" />

      <div className="flex items-center gap-1">
        <DropdownButton label="New" items={newItems} onDefaultAction={() => addTabToFocusedPane(PaneTabKind.Shell, "Shell")} />
        <DropdownButton label="Split" items={splitItems} onDefaultAction={() => splitWithTab(PaneTabKind.Shell, "Shell")} />
        <DropdownButton label="PR" icon={PRIcon} items={prItems} />
      </div>
    </div>
  );
}
