import { useRef, useState, useCallback, useEffect } from "react";
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

  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const addTabToPane = useCallback(
    (kind: PaneTabKind, label: string, extras?: Record<string, unknown>) => {
      const payload: Record<string, unknown> = { ...extras };
      if (kind === PaneTabKind.Shell || kind === PaneTabKind.Claude) {
        payload.terminalId = crypto.randomUUID();
      }
      if (kind === PaneTabKind.Browser) {
        payload.browserURL ??= "https://google.com";
      }
      addTab(pane.id, createTab(kind, label, payload));
      setPlusMenuOpen(false);
    },
    [pane.id],
  );

  // Close on click outside
  useEffect(() => {
    if (!plusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [plusMenuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!plusMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlusMenuOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [plusMenuOpen]);

  return (
    <div
      className={`
        relative flex h-8 items-center flex-shrink-0
        bg-[var(--ctp-mantle)] border-b border-[var(--ctp-surface0)]
        overflow-hidden
      `}
    >
      <div
        ref={containerRef}
        className="flex items-center h-full flex-1 min-w-0 overflow-hidden"
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
      </div>
      <div ref={plusMenuRef} className="flex-shrink-0 flex items-center px-1">
        <button
          ref={plusBtnRef}
          className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--ctp-overlay0)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)] text-sm transition-colors"
          onClick={() => {
            if (!plusMenuOpen && plusBtnRef.current) {
              const rect = plusBtnRef.current.getBoundingClientRect();
              setMenuPos({ top: rect.bottom + 4, left: rect.right });
            }
            setPlusMenuOpen((o) => !o);
          }}
          title="New tab"
        >
          +
        </button>
        {plusMenuOpen && (
          <div
            className="fixed w-[160px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-lg overflow-hidden"
            style={{ zIndex: 50, top: menuPos.top, right: window.innerWidth - menuPos.left }}
          >
            <button onClick={() => addTabToPane(PaneTabKind.Shell, "Shell")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors">Terminal</button>
            <button onClick={() => addTabToPane(PaneTabKind.Claude, "Claude")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors">Claude</button>
            <button onClick={() => addTabToPane(PaneTabKind.Claude, "Claude", { resume: true })} className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors">Claude (Continue)</button>
            <button onClick={() => addTabToPane(PaneTabKind.Browser, "Browser")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors">Browser</button>
            <button onClick={() => addTabToPane(PaneTabKind.HistoryViewer, "History")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-colors">Chat History</button>
          </div>
        )}
      </div>
    </div>
  );
}
