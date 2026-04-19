import { useEffect } from "react";
import { useStore, DEFAULT_RUN_PANE_HEIGHT } from "../../state/store";
import {
  closeRunTab,
  hydrateRunPaneForWorkspace,
  restartRunTab,
  selectRunTab,
  setRunPaneVisible,
  stopRunTab,
} from "../../state/run-pane-actions";
import type { RunTab } from "../../models/run-tab";
import { RunPaneResizeHandle } from "./RunPaneResizeHandle";
import { RunPaneTabBar } from "./RunPaneTabBar";
import { RunPaneTerminal } from "./RunPaneTerminal";
import { RunPaneToolbar } from "./RunPaneToolbar";

interface RunPaneProps {
  workspacePath: string;
}

// Stable empty-array reference. A fresh `[]` inside a Zustand selector
// breaks `useSyncExternalStore`'s snapshot caching (the result differs on
// every call), which triggers "Maximum update depth exceeded" and crashes
// the whole React tree.
const EMPTY_TABS: RunTab[] = [];

export function RunPane({ workspacePath }: RunPaneProps) {
  const visible = useStore((s) => s.runPaneVisible[workspacePath] ?? false);
  const height = useStore((s) => s.runPaneHeight[workspacePath] ?? DEFAULT_RUN_PANE_HEIGHT);
  const tabs = useStore((s) => s.runPaneTabs[workspacePath] ?? EMPTY_TABS);
  const activeTabId = useStore((s) => s.runPaneActiveTabId[workspacePath] ?? null);

  useEffect(() => {
    hydrateRunPaneForWorkspace(workspacePath);
  }, [workspacePath]);

  // Always stay mounted so hiding the pane doesn't unmount — and kill —
  // the running PTYs inside it. When `visible` is false, collapse the
  // container to zero height and clip overflow; the tabs and terminals
  // remain in the DOM and keep streaming output in the background.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div
      className="flex flex-col flex-shrink-0 w-full"
      style={{
        height: visible ? height : 0,
        overflow: "hidden",
        backgroundColor: "var(--ctp-base)",
        borderTop: visible ? "1px solid var(--ctp-surface0)" : "none",
      }}
      aria-hidden={!visible}
    >
      <RunPaneResizeHandle workspacePath={workspacePath} />
      <RunPaneToolbar
        activeTab={activeTab}
        onRestart={() => activeTab && restartRunTab(workspacePath, activeTab.id)}
        onStop={() => activeTab && stopRunTab(workspacePath, activeTab.id)}
        onHide={() => setRunPaneVisible(workspacePath, false)}
      />
      <RunPaneTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={(id) => selectRunTab(workspacePath, id)}
        onClose={(id) => closeRunTab(workspacePath, id)}
      />
      <div className="flex-1 min-h-0 relative">
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--ctp-overlay1)]">
            No scripts running. Start a script configured for the Run pane to see it here.
          </div>
        )}
        {tabs.map((tab) => (
          <RunPaneTerminal
            key={tab.id}
            workspacePath={workspacePath}
            tab={tab}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}
