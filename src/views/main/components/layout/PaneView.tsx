import { memo, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import type { Pane, PaneTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { TabBar } from "./TabBar";
import { PaneDropZone } from "./PaneDropZone";
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
  workspacePath: string;
}

function TabContent({ tab, paneId, isFocused, isVisible, workspacePath }: { tab: PaneTab; paneId: string; isFocused: boolean; isVisible: boolean; workspacePath: string }) {
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
          cwd={workspacePath || "/tmp"}
          sessionId={tab.sessionId}
          resume={tab.resume}
          isFocused={isFocused}
          onCloseRequest={handleCloseRequest}
        />
      );
    case PaneTabKind.Browser:
      return (
        <BrowserPane
          paneId={paneId}
          tab={tab}
          repoPath={workspacePath || ""}
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
          cwd={workspacePath || "/tmp"}
          isFocused={isFocused}
          onCloseRequest={handleCloseRequest}
        />
      );
    default:
      return null;
  }
}

export const PaneView = memo(function PaneView({ pane, workspacePath }: PaneViewProps) {
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
        <PaneDropZone paneId={pane.id} tabCount={pane.tabs.length} />
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
              workspacePath={workspacePath}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
