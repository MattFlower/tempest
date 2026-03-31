import { useRef, useState, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane } from "../../models/pane-node";
import { createTab } from "../../models/pane-node";
import { addTab, moveTab } from "../../state/actions";
import { TabButton, TAB_DRAG_MIME, type TabDragData } from "./TabButton";

function computeInsertionPoint(
  container: HTMLElement,
  clientX: number,
): { index: number; leftPx: number } {
  const tabButtons = Array.from(
    container.querySelectorAll("[draggable]"),
  ) as HTMLElement[];
  const containerLeft = container.getBoundingClientRect().left;

  for (let i = 0; i < tabButtons.length; i++) {
    const rect = tabButtons[i]!.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { index: i, leftPx: rect.left - containerLeft };
    }
  }

  if (tabButtons.length > 0) {
    const lastRect = tabButtons[tabButtons.length - 1]!.getBoundingClientRect();
    return { index: tabButtons.length, leftPx: lastRect.right - containerLeft };
  }

  return { index: 0, leftPx: 0 };
}

interface TabBarProps {
  pane: Pane;
}

export function TabBar({ pane }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragIndicator, setDragIndicator] = useState<{
    index: number;
    leftPx: number;
  } | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const container = containerRef.current;
    if (!container) return;
    setDragIndicator(computeInsertionPoint(container, e.clientX));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragIndicator(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragIndicator(null);
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) return;

      const data: TabDragData = JSON.parse(raw);
      const container = containerRef.current;
      if (!container) return;

      const { index } = computeInsertionPoint(container, e.clientX);
      moveTab(data.tabId, data.sourcePaneId, pane.id, index);
    },
    [pane.id],
  );

  const handleAddShell = useCallback(() => {
    const tab = createTab(PaneTabKind.Shell, "Shell", {
      terminalId: crypto.randomUUID(),
    });
    addTab(pane.id, tab);
  }, [pane.id]);

  const handleAddClaude = useCallback(() => {
    const tab = createTab(PaneTabKind.Claude, "Claude", {
      terminalId: crypto.randomUUID(),
    });
    addTab(pane.id, tab);
  }, [pane.id]);

  const handleAddBrowser = useCallback(() => {
    const tab = createTab(PaneTabKind.Browser, "Browser", {
      browserURL: "https://google.com",
    });
    addTab(pane.id, tab);
  }, [pane.id]);

  return (
    <div
      ref={containerRef}
      className={`
        relative flex h-8 items-center flex-shrink-0
        bg-[var(--ctp-mantle)] border-b border-[var(--ctp-surface0)]
        overflow-x-auto
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragIndicator && (
        <div
          className="absolute top-1 bottom-1 w-0.5 bg-[var(--ctp-blue)] rounded-full pointer-events-none z-10"
          style={{ left: dragIndicator.leftPx }}
        />
      )}

      {pane.tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          paneId={pane.id}
          isSelected={tab.id === pane.selectedTabId}
        />
      ))}
      <div className="flex-shrink-0 flex items-center px-1 relative">
        <button
          className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--ctp-overlay0)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)] text-sm transition-colors"
          onClick={handleAddShell}
          title="New tab (Shell)"
        >
          +
        </button>
      </div>
    </div>
  );
}
