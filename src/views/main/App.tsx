// ============================================================
// App — Root layout component.
// Sidebar (fixed width, collapsible) + Workspace Detail (flex).
// Stream E implements Sidebar, Stream B implements workspace detail.
// ============================================================

import { useStore } from "./state/store";
import { WorkspaceDetail } from "./components/layout";

export function App() {
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const sidebarWidth = useStore((s) => s.sidebarWidth);

  return (
    <div className="flex h-full w-full">
      {/* Sidebar — Stream E fills this in */}
      {sidebarVisible && (
        <div
          className="flex-shrink-0 border-r border-[var(--ctp-surface0)] bg-[var(--ctp-mantle)]"
          style={{ width: sidebarWidth }}
        >
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            Sidebar (Stream E)
          </div>
        </div>
      )}

      {/* Workspace Detail */}
      <div className="flex-1 min-w-0">
        <WorkspaceDetail />
      </div>
    </div>
  );
}
