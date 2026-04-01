import { useState, useCallback, useEffect } from "react";
import { TAB_DRAG_MIME, type TabDragData } from "./TabButton";
import { moveTabToNewPane } from "../../state/actions";
import { useStore } from "../../state/store";

interface PaneDropZoneProps {
  paneId: string;
  tabCount: number;
}

type DropSide = "left" | "right" | null;

export function PaneDropZone({ paneId, tabCount }: PaneDropZoneProps) {
  const isTabDragActive = useStore((s) => s.isTabDragActive);
  const [activeSide, setActiveSide] = useState<DropSide>(null);

  // Safety net: reset drag state when drag ends abnormally (Escape, window
  // blur, Cmd+Tab, Mission Control, mouse released outside window, etc.).
  useEffect(() => {
    if (!isTabDragActive) return;

    const resetDrag = () => {
      useStore.getState().setTabDragActive(false);
    };

    // Capture-phase dragend catches terminations even if source element unmounted
    document.addEventListener("dragend", resetDrag, true);
    // Window losing focus (Cmd+Tab, clicking outside app)
    window.addEventListener("blur", resetDrag);
    // Document hidden (Mission Control, Space switch)
    document.addEventListener("visibilitychange", resetDrag);

    return () => {
      document.removeEventListener("dragend", resetDrag, true);
      window.removeEventListener("blur", resetDrag);
      document.removeEventListener("visibilitychange", resetDrag);
    };
  }, [isTabDragActive]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setActiveSide(e.clientX < midX ? "left" : "right");
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setActiveSide(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setActiveSide(null);
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) return;

      const data: TabDragData = JSON.parse(raw);

      // No-op: dragging the only tab in a pane onto its own content area
      if (data.sourcePaneId === paneId && tabCount <= 1) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const direction = e.clientX < midX ? "left" : "right";

      moveTabToNewPane(data.tabId, data.sourcePaneId, paneId, direction);
    },
    [paneId, tabCount],
  );

  if (!isTabDragActive) return null;

  return (
    <div
      className="absolute inset-0 z-20"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeSide === "left" && (
        <div className="absolute inset-y-0 left-0 w-1/2 bg-[var(--ctp-blue)]/10 border-2 border-[var(--ctp-blue)]/30 rounded-l-md pointer-events-none" />
      )}
      {activeSide === "right" && (
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[var(--ctp-blue)]/10 border-2 border-[var(--ctp-blue)]/30 rounded-r-md pointer-events-none" />
      )}
    </div>
  );
}
