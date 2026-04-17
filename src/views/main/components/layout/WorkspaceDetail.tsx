import { useEffect } from "react";
import { PaneTabKind, ViewMode } from "../../../../shared/ipc-types";
import type { PaneNode } from "../../models/pane-node";
import { createPane, createTab, createLeaf, createSplit, allPanes, findPane } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { PaneTreeView } from "./PaneTreeView";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { PRDashboard } from "../pr/PRDashboard";
import { VCSView } from "../vcs/VCSView";
import { initTerminalDispatch } from "../../state/terminal-dispatch";
import { addTab, splitPane, focusNextPane, focusPreviousPane, toggleMaximize, closeTab } from "../../state/actions";

// Normalize: if root is a leaf, wrap it in a single-child split.
// This prevents React from tearing down & recreating the component
// tree when transitioning between 1 and 2 panes.
function normalize(node: PaneNode): PaneNode {
  if (node.type === "leaf") {
    return createSplit([node], [1]);
  }
  return node;
}

interface WorkspaceDetailProps {
  workspacePath: string;
}

export function WorkspaceDetail({ workspacePath }: WorkspaceDetailProps) {
  const paneTrees = useStore((s) => s.paneTrees);
  const setPaneTree = useStore((s) => s.setPaneTree);
  const setFocusedPaneId = useStore((s) => s.setFocusedPaneId);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const viewMode = useStore(
    (s) => s.workspaceViewMode[workspacePath] ?? ViewMode.Terminal,
  );
  const setViewMode = useStore((s) => s.setViewMode);

  const tree = paneTrees[workspacePath];

  // Initialize terminal dispatch once
  useEffect(() => {
    initTerminalDispatch();
  }, []);

  // Keyboard shortcuts for pane operations and view mode switching
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle if this workspace is selected
      if (useStore.getState().selectedWorkspacePath !== workspacePath) return;

      if (e.metaKey && e.key === "d") {
        e.preventDefault();
        splitPane("right");
      }
      if (e.metaKey && e.key === "]") {
        e.preventDefault();
        focusNextPane();
      }
      if (e.metaKey && e.key === "[") {
        e.preventDefault();
        focusPreviousPane();
      }
      if (e.metaKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        toggleMaximize();
      }
      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        const state = useStore.getState();
        const { focusedPaneId } = state;
        const tree = state.paneTrees[workspacePath];
        if (focusedPaneId && tree) {
          const pane = findPane(tree, focusedPaneId);
          if (pane?.selectedTabId) {
            closeTab(focusedPaneId, pane.selectedTabId);
          }
        }
      }
      if (e.metaKey && e.key === "t") {
        e.preventDefault();
        const { focusedPaneId } = useStore.getState();
        if (focusedPaneId) {
          const tab = createTab(PaneTabKind.Claude, "Claude", {
            terminalId: crypto.randomUUID(),
          });
          addTab(focusedPaneId, tab);
        }
      }
      // View mode shortcuts: Cmd+1 = Terminal, Cmd+2 = VCS, Cmd+3 = Dashboard
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        const modeForKey: Record<string, ViewMode> = {
          "1": ViewMode.Terminal,
          "2": ViewMode.VCS,
          "3": ViewMode.Dashboard,
        };
        const mode = modeForKey[e.key];
        if (mode) {
          e.preventDefault();
          useStore.getState().setProgressViewActive(false);
          setViewMode(workspacePath, mode);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [workspacePath, setViewMode]);

  // Create a default pane tree if workspace has no tree yet
  useEffect(() => {
    if (workspacePath && !paneTrees[workspacePath]) {
      const terminalId = crypto.randomUUID();
      const tab = createTab(PaneTabKind.Claude, "Claude", {
        terminalId,
      });
      const pane = createPane(tab);
      const leaf = createLeaf(pane);
      setPaneTree(workspacePath, leaf);
      setFocusedPaneId(pane.id);
    }
  }, [workspacePath, paneTrees, setPaneTree, setFocusedPaneId]);

  // Ensure a valid pane is focused when this workspace becomes active
  useEffect(() => {
    if (workspacePath !== selectedWorkspacePath) return;
    if (!tree) return;
    const { focusedPaneId } = useStore.getState();
    if (!focusedPaneId || !findPane(tree, focusedPaneId)) {
      const panes = allPanes(tree);
      if (panes.length > 0) {
        setFocusedPaneId(panes[0]!.id);
      }
    }
  }, [workspacePath, selectedWorkspacePath, tree, setFocusedPaneId]);

  if (!tree) {
    return null; // Will be created by useEffect
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Workspace toolbar — name, status badge, action buttons */}
      <WorkspaceToolbar workspacePath={workspacePath} />

      {/* ZStack keeps terminal views alive across view mode switches.
          CRITICAL: Never unmount the terminal — use opacity to hide it.
          Same pattern as PaneView tab switching and App workspace switching. */}
      <div className="relative flex-1 min-h-0">
        {/* Terminal mode — always rendered, hidden with opacity */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.Terminal
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          <PaneTreeView node={normalize(tree)} workspacePath={workspacePath} />
        </div>

        {/* Dashboard mode — always rendered to preserve monitoring state */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.Dashboard
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          <PRDashboard />
        </div>

        {/* VCS mode — always rendered to preserve scroll/selection/staged state */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.VCS
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          <VCSView />
        </div>
      </div>
    </div>
  );
}
