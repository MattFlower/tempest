import { memo, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane, PaneTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { TabBar } from "./TabBar";
import { TerminalPane } from "../terminal/TerminalPane";
import { BrowserPane } from "../browser/BrowserPane";

interface PaneViewProps {
  pane: Pane;
}

function TabContent({ tab, paneId, isFocused }: { tab: PaneTab; paneId: string; isFocused: boolean }) {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  switch (tab.kind) {
    case PaneTabKind.Shell:
      if (!tab.terminalId) {
        return (
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            No terminal ID — tab not initialized
          </div>
        );
      }
      return (
        <TerminalPane
          terminalId={tab.terminalId}
          command={["/bin/zsh"]}
          cwd={selectedWorkspacePath || "/tmp"}
          isFocused={isFocused}
        />
      );
    case PaneTabKind.Claude:
      if (!tab.terminalId) {
        return (
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            No terminal ID — tab not initialized
          </div>
        );
      }
      return (
        <TerminalPane
          terminalId={tab.terminalId}
          command={["/bin/zsh", "-lic", "exec claude"]}
          cwd={selectedWorkspacePath || "/tmp"}
          isFocused={isFocused}
        />
      );
    case PaneTabKind.Browser:
      return (
        <BrowserPane
          paneId={paneId}
          tab={tab}
          repoPath={selectedWorkspacePath || ""}
          isFocused={isFocused}
        />
      );
    case PaneTabKind.HistoryViewer:
      return (
        <div className="flex h-full items-center justify-center text-[var(--ctp-subtext0)] text-xs">
          History Viewer (Phase 2)
        </div>
      );
    case PaneTabKind.MarkdownViewer:
      return (
        <div className="flex h-full items-center justify-center text-[var(--ctp-subtext0)] text-xs">
          Markdown: {tab.markdownFilePath}
        </div>
      );
    case PaneTabKind.Editor:
      return (
        <div className="flex h-full items-center justify-center text-[var(--ctp-subtext0)] text-xs">
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
            <TabContent
              tab={tab}
              paneId={pane.id}
              isFocused={isFocused && tab.id === pane.selectedTabId}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
