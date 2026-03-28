import { useEffect } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { PaneNode } from "../../models/pane-node";
import { createPane, createTab, createLeaf, createSplit } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { PaneTreeView } from "./PaneTreeView";
import { initTerminalDispatch } from "../../state/terminal-dispatch";
import { splitPane, focusNextPane, focusPreviousPane, toggleMaximize } from "../../state/actions";

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

  const tree = paneTrees[workspacePath];

  // Initialize terminal dispatch once
  useEffect(() => {
    initTerminalDispatch();
  }, []);

  // Keyboard shortcuts for pane operations
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
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [workspacePath]);

  // Create a default pane tree if workspace has no tree yet
  useEffect(() => {
    if (workspacePath && !paneTrees[workspacePath]) {
      const terminalId = crypto.randomUUID();
      const tab = createTab(PaneTabKind.Shell, "Shell", {
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

  return <PaneTreeView node={normalize(tree)} />;
}
