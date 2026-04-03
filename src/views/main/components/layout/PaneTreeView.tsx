import { memo } from "react";
import type { PaneNode } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { containsPane } from "../../state/actions";
import { PaneView } from "./PaneView";
import { PaneDivider } from "./PaneDivider";

interface PaneTreeViewProps {
  node: PaneNode; // always a split node (normalized by WorkspaceDetail)
  workspacePath: string;
}

export const PaneTreeView = memo(function PaneTreeView({
  node,
  workspacePath,
}: PaneTreeViewProps) {
  const maximizedPaneId = useStore((s) => s.maximizedPaneId);
  const isMaximized = maximizedPaneId !== null;

  if (node.type === "leaf") {
    return <PaneView pane={node.pane} workspacePath={workspacePath} />;
  }

  const { children, ratios, id: splitId } = node;

  // Normalize ratios so they sum to 1 (callers may pass proportional values like [1,1,1])
  const totalRatio = ratios.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-row h-full w-full overflow-hidden">
      {children.map((child, i) => {
        const childId =
          child.type === "leaf" ? child.pane.id : child.id;

        // Maximize logic: the child containing the maximized pane gets
        // full width; all others collapse to 0
        const isMaxTarget =
          isMaximized && containsPane(child, maximizedPaneId!);
        const isCollapsed = isMaximized && !isMaxTarget;

        const widthPercent = isMaximized
          ? isMaxTarget
            ? 100
            : 0
          : ((ratios[i] ?? 0) / totalRatio) * 100;

        return (
          <div key={childId} className="flex flex-row" style={{ display: "contents" }}>
            {/* Divider before this child (except the first) */}
            {i > 0 && (
              <PaneDivider
                splitId={splitId}
                index={i - 1}
                hidden={isMaximized}
              />
            )}

            {/* Child pane or nested split */}
            <div
              className={`overflow-hidden flex-shrink-0 ${
                isCollapsed ? "opacity-0 pointer-events-none" : ""
              }`}
              style={{
                width: `${widthPercent}%`,
                minWidth: isCollapsed ? 0 : undefined,
              }}
            >
              {child.type === "leaf" ? (
                <PaneView pane={child.pane} workspacePath={workspacePath} />
              ) : (
                <PaneTreeView node={child} workspacePath={workspacePath} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
