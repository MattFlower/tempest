import { useState, useCallback, useRef, useMemo } from "react";
import { useStore } from "./state/store";
import { Sidebar } from "./components/sidebar/Sidebar";
import { CommandPalette } from "./components/palette/CommandPalette";
import { WorkspaceDetail } from "./components/layout";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;

export function App() {
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const paneTrees = useStore((s) => s.paneTrees);

  // All workspace paths to render: selected + any with existing trees
  const allWorkspacePaths = useMemo(() => {
    const paths = new Set(Object.keys(paneTrees));
    if (selectedWorkspacePath) paths.add(selectedWorkspacePath);
    return Array.from(paths);
  }, [paneTrees, selectedWorkspacePath]);

  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = startWidth.current + (ev.clientX - startX.current);
        setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)));
      };
      const onMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth, setSidebarWidth]
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Titlebar drag region — spans full window width */}
      <div className="titlebar-drag h-10 flex-shrink-0" />

      {/* Main content area below titlebar */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarVisible && (
          <>
            <div className="flex-shrink-0" style={{ width: sidebarWidth }}>
              <Sidebar />
            </div>

            {/* Draggable divider */}
            <div
              className="w-px flex-shrink-0 cursor-col-resize"
              style={{
                backgroundColor: isDragging ? "var(--ctp-blue)" : "var(--ctp-surface0)",
                padding: "0 2px",
                margin: "0 -2px",
              }}
              onMouseDown={onDividerMouseDown}
            />
          </>
        )}

        {/* Workspace Detail — all visited workspaces rendered simultaneously,
            hidden with opacity pattern to preserve terminal state. */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* Workspace views — stacked, only selected is visible.
              Includes selected workspace (even if no tree yet) plus all
              previously visited workspaces (to keep their terminals alive). */}
          {allWorkspacePaths.map((wsPath) => (
            <div
              key={wsPath}
              className={`absolute inset-0 ${
                wsPath === selectedWorkspacePath
                  ? "opacity-100"
                  : "opacity-0 pointer-events-none"
              }`}
            >
              <WorkspaceDetail workspacePath={wsPath} />
            </div>
          ))}

          {/* Empty state — shown when no workspace selected */}
          {!selectedWorkspacePath && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--ctp-overlay0)]">
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
                <path d="M4 17.27V4h16v13.27l-2-1.15-2 1.15-2-1.15-2 1.15-2-1.15-2 1.15-2-1.15-2 1.15ZM2 2v18l4-2.3 2 1.15 2-1.15 2 1.15 2-1.15 2 1.15 2-1.15L22 20V2H2Z" />
              </svg>
              <span className="text-sm">No Workspace Selected</span>
              <span className="text-xs">Select a workspace from the sidebar or create a new one.</span>
            </div>
          )}
        </div>
      </div>

      {/* Command Palette overlay */}
      <CommandPalette />
    </div>
  );
}
