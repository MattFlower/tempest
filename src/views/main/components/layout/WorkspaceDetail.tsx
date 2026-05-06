import { useEffect, useState } from "react";
import { ViewMode } from "../../../../shared/ipc-types";
import type { PaneNode } from "../../models/pane-node";
import { createSplit, allPanes, findPane } from "../../models/pane-node";
import { createDefaultWorkspacePaneTree } from "../../models/default-pane";
import { useStore } from "../../state/store";
import { PaneTreeView } from "./PaneTreeView";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { PRDashboard } from "../pr/PRDashboard";
import { VCSView } from "../vcs/VCSView";
import { initTerminalDispatch } from "../../state/terminal-dispatch";

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
  const defaultPaneKind = useStore((s) => s.config?.defaultPaneKind);
  const viewMode = useStore(
    (s) => s.workspaceViewMode[workspacePath] ?? ViewMode.Terminal,
  );

  // Tracks whether the user has ever entered VCS mode during this component's lifetime.
  // Used to lazy-mount VCSView on first visit and keep it mounted thereafter so its
  // internal state (scroll position, selected file, staged/partial diffs) survives
  // subsequent view-mode switches — without paying VCSView's mount cost (jj log,
  // file watchers, store subscriptions) on startup before the user ever visits VCS.
  const [hasEnteredVCS, setHasEnteredVCS] = useState(false);

  const tree = paneTrees[workspacePath];

  // Initialize terminal dispatch once
  useEffect(() => {
    initTerminalDispatch();
  }, []);

  // Latch hasEnteredVCS to true the first time the user switches to VCS mode.
  // Never flips back to false — VCSView stays alive for the rest of this component's lifetime.
  useEffect(() => {
    if (viewMode === ViewMode.VCS) setHasEnteredVCS(true);
  }, [viewMode]);

  // Keyboard shortcuts live in the global dispatcher — see
  // src/views/main/keybindings/dispatcher.ts and src/views/main/commands/registry.ts.

  // Create a default pane tree if workspace has no tree yet
  useEffect(() => {
    if (workspacePath && !paneTrees[workspacePath]) {
      const { tree, paneId } = createDefaultWorkspacePaneTree(defaultPaneKind);
      setPaneTree(workspacePath, tree);
      setFocusedPaneId(paneId);
    }
  }, [workspacePath, paneTrees, defaultPaneKind, setPaneTree, setFocusedPaneId]);

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

        {/* VCS mode — lazy-mounted on first visit, then kept alive (hidden via opacity)
            so JJView's scroll position, selected file, and staged/partial diff state
            survive subsequent VCS↔Terminal switches. Staying unmounted until first visit
            avoids paying VCSView/JJView mount cost (jj log, file watchers, store
            subscriptions) during startup session resume when the user is in Terminal mode. */}
        <div
          className={`absolute inset-0 ${
            viewMode === ViewMode.VCS
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {hasEnteredVCS && <VCSView />}
        </div>
      </div>
    </div>
  );
}
