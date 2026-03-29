import { memo, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane, PaneTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { TabBar } from "./TabBar";
import { TerminalPane } from "../terminal/TerminalPane";
import { BrowserPane } from "../browser/BrowserPane";
import { HistoryViewer } from "../history/HistoryViewer";
import { MarkdownViewer } from "../markdown/MarkdownViewer";
import { DiffView } from "../diff/DiffView";
import { PRDashboard } from "../pr/PRDashboard";
import { EditorPane } from "../editor/EditorPane";
import { closeTab } from "../../state/actions";

interface PaneViewProps {
  pane: Pane;
}

function TabContent({ tab, paneId, isFocused, isVisible }: { tab: PaneTab; paneId: string; isFocused: boolean; isVisible: boolean }) {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const handleCloseRequest = useCallback(() => {
    closeTab(paneId, tab.id);
  }, [paneId, tab.id]);

  switch (tab.kind) {
    case PaneTabKind.Shell:
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
          tabKind={tab.kind}
          cwd={selectedWorkspacePath || "/tmp"}
          sessionId={tab.sessionId}
          isFocused={isFocused}
          onCloseRequest={handleCloseRequest}
        />
      );
    case PaneTabKind.Browser:
      return (
        <BrowserPane
          paneId={paneId}
          tab={tab}
          repoPath={selectedWorkspacePath || ""}
          isFocused={isFocused}
          isVisible={isVisible}
        />
      );
    case PaneTabKind.HistoryViewer:
      return <HistoryViewer />;
    case PaneTabKind.MarkdownViewer:
      return <MarkdownViewer filePath={tab.markdownFilePath} />;
    case PaneTabKind.DiffViewer:
      return <DiffView />;
    case PaneTabKind.PRDashboard:
      return <PRDashboard />;
    case PaneTabKind.Editor:
      if (!tab.terminalId || !tab.editorFilePath) {
        return (
          <div className="flex h-full items-center justify-center text-[var(--ctp-overlay0)] text-xs">
            Editor tab not initialized
          </div>
        );
      }
      return (
        <EditorPane
          terminalId={tab.terminalId}
          filePath={tab.editorFilePath}
          lineNumber={tab.editorLineNumber}
          cwd={selectedWorkspacePath || "/tmp"}
          isFocused={isFocused}
          onCloseRequest={handleCloseRequest}
        />
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
            ? "border border-[var(--ctp-surface1)]"
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
              isVisible={tab.id === pane.selectedTabId}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
