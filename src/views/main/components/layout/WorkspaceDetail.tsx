import { useEffect } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { PaneNode } from "../../models/pane-node";
import { createPane, createTab, createLeaf, createSplit } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { PaneTreeView } from "./PaneTreeView";

// Normalize: if root is a leaf, wrap it in a single-child split.
// This prevents React from tearing down & recreating the component
// tree when transitioning between 1 and 2 panes.
function normalize(node: PaneNode): PaneNode {
  if (node.type === "leaf") {
    return createSplit([node], [1]);
  }
  return node;
}

export function WorkspaceDetail() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const paneTrees = useStore((s) => s.paneTrees);
  const setPaneTree = useStore((s) => s.setPaneTree);
  const setFocusedPaneId = useStore((s) => s.setFocusedPaneId);

  const tree = selectedWorkspacePath
    ? paneTrees[selectedWorkspacePath]
    : undefined;

  // Create a default pane tree if workspace is selected but has no tree
  useEffect(() => {
    if (selectedWorkspacePath && !paneTrees[selectedWorkspacePath]) {
      const tab = createTab(PaneTabKind.Shell, "Shell");
      const pane = createPane(tab);
      const leaf = createLeaf(pane);
      setPaneTree(selectedWorkspacePath, leaf);
      setFocusedPaneId(pane.id);
    }
  }, [selectedWorkspacePath, paneTrees, setPaneTree, setFocusedPaneId]);

  if (!selectedWorkspacePath) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
        No workspace selected
      </div>
    );
  }

  if (!tree) {
    return null; // Will be created by useEffect
  }

  return <PaneTreeView node={normalize(tree)} />;
}
