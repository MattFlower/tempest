import { useRef, useState, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane } from "../../models/pane-node";
import { createTab } from "../../models/pane-node";
import { addTab, moveTab } from "../../state/actions";
import { TabButton, TAB_DRAG_MIME, type TabDragData } from "./TabButton";

interface TabBarProps {
  pane: Pane;
}

export function TabBar({ pane }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TAB_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) return;

      const data: TabDragData = JSON.parse(raw);
      const container = containerRef.current;
      if (!container) return;

      // Compute insertion index from cursor position
      const tabButtons = Array.from(
        container.querySelectorAll("[draggable]"),
      ) as HTMLElement[];
      let insertionIndex = tabButtons.length;
      for (let i = 0; i < tabButtons.length; i++) {
        const rect = tabButtons[i]!.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          insertionIndex = i;
          break;
        }
      }

      moveTab(data.tabId, data.sourcePaneId, pane.id, insertionIndex);
    },
    [pane.id],
  );

  const handleAddTab = useCallback(() => {
    const tab = createTab(PaneTabKind.Shell, "Shell");
    addTab(pane.id, tab);
  }, [pane.id]);

  return (
    <div
      ref={containerRef}
      className={`
        flex h-8 items-center flex-shrink-0
        bg-[var(--ctp-mantle)] border-b border-[var(--ctp-surface0)]
        overflow-x-auto
        ${isDragOver ? "bg-[var(--ctp-surface0)]" : ""}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pane.tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          paneId={pane.id}
          isSelected={tab.id === pane.selectedTabId}
        />
      ))}
      <button
        className="flex-shrink-0 px-2 text-[var(--ctp-overlay0)] hover:text-[var(--ctp-text)] text-sm"
        onClick={handleAddTab}
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
