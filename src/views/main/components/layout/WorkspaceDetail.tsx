import { useEffect } from "react";
import { PaneTabKind, ViewMode } from "../../../../shared/ipc-types";
import type { PaneNode } from "../../models/pane-node";
import { createPane, createTab, createLeaf, createSplit } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { PaneTreeView } from "./PaneTreeView";
import { ViewModeBar } from "./ViewModeBar";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { DiffView } from "../diff/DiffView";
import { PRDashboard } from "../pr/PRDashboard";
import { VCSView } from "../vcs/VCSView";
import { initTerminalDispatch } from "../../state/terminal-dispatch";
import { addTab, splitPane, focusNextPane, focusPreviousPane, toggleMaximize, closeTab } from "../../state/actions";
import { findPane } from "../../models/pane-node";

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
      // View mode shortcuts: Cmd+1 = Terminal, Cmd+2 = Diff, Cmd+3 = Dashboard
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.key === "1") {
          e.preventDefault();
          setViewMode(workspacePath, ViewMode.Terminal);
        }
        if (e.key === "2") {
          e.preventDefault();
          setViewMode(workspacePath, ViewMode.Diff);
        }
        if (e.key === "3") {
          e.preventDefault();
          setViewMode(workspacePath, ViewMode.Dashboard);
        }
        if (e.key === "4") {
          e.preventDefault();
          setViewMode(workspacePath, ViewMode.VCS);
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

  if (!tree) {
    return null; // Will be created by useEffect
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* View mode selector bar — no bottom border for seamless transition */}
      <div style={{ borderBottom: "none" }}>
        <ViewModeBar workspacePath={workspacePath} />
      </div>

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

        {/* Diff mode */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.Diff
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {viewMode === ViewMode.Diff && <DiffView />}
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

        {/* VCS mode */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.VCS
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {viewMode === ViewMode.VCS && <VCSView />}
        </div>
      </div>
    </div>
  );
}
