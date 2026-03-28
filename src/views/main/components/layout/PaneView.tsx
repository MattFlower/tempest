import { memo, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane, PaneTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { TabBar } from "./TabBar";

interface PaneViewProps {
  pane: Pane;
}

function TabContent({ tab, paneId }: { tab: PaneTab; paneId: string }) {
  switch (tab.kind) {
    case PaneTabKind.Claude:
    case PaneTabKind.Shell:
      return (
        <div
          className="h-full w-full bg-[var(--ctp-base)]"
          data-terminal-id={tab.terminalId}
          data-pane-id={paneId}
          data-tab-id={tab.id}
        >
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            {tab.kind === PaneTabKind.Claude ? "Claude" : "Shell"} &mdash;{" "}
            {tab.label}
          </div>
        </div>
      );
    case PaneTabKind.Browser:
      return (
        <div
          className="h-full w-full bg-[var(--ctp-base)]"
          data-browser-url={tab.browserUrl}
          data-pane-id={paneId}
          data-tab-id={tab.id}
        >
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            Browser &mdash; {tab.browserUrl ?? "about:blank"}
          </div>
        </div>
      );
    case PaneTabKind.HistoryViewer:
      return (
        <div className="h-full w-full p-4 text-[var(--ctp-subtext0)] text-xs">
          History Viewer
        </div>
      );
    case PaneTabKind.MarkdownViewer:
      return (
        <div className="h-full w-full p-4 text-[var(--ctp-subtext0)] text-xs">
          Markdown: {tab.markdownFilePath}
        </div>
      );
    case PaneTabKind.Editor:
      return (
        <div className="h-full w-full p-4 text-[var(--ctp-subtext0)] text-xs">
          Editor: {tab.editorFilePath}
        </div>
      );
    default:
      return null;
  }
}

export const PaneView = memo(function PaneView({ pane }: PaneViewProps) {
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const setFocusedPaneId = useStore((s) => s.setFocusedPaneId);
  const isFocused = focusedPaneId === pane.id;

  const handleFocus = useCallback(() => {
    setFocusedPaneId(pane.id);
  }, [pane.id, setFocusedPaneId]);

  return (
    <div
      className={`
        flex flex-col h-full w-full overflow-hidden
        ${
          isFocused
            ? "border-2 border-[var(--ctp-blue)]"
            : "border border-[var(--ctp-surface0)]"
        }
      `}
      onMouseDown={handleFocus}
    >
      <TabBar pane={pane} />

      {/* Content area — ZStack with opacity pattern */}
      <div className="relative flex-1 overflow-hidden">
        {pane.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${
              tab.id === pane.selectedTabId
                ? "opacity-100"
                : "opacity-0 pointer-events-none"
            }`}
          >
            <TabContent tab={tab} paneId={pane.id} />
          </div>
        ))}
      </div>
    </div>
  );
});
