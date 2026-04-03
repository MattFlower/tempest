import { ActivityState, PaneTabKind, ProgressState } from "../../../../shared/ipc-types";
import type { PaneTab } from "../../models/pane-node";
import { selectTab, closeTab } from "../../state/actions";
import { useStore } from "../../state/store";

export interface TabDragData {
  tabId: string;
  sourcePaneId: string;
  tabKind: PaneTabKind;
  label: string;
}

export const TAB_DRAG_MIME = "application/x-tempest-tab";

function activityColor(tab: PaneTab): string {
  if (!tab.isAlive) return "bg-[var(--ctp-yellow)]";
  switch (tab.activityState) {
    case ActivityState.Working:
      return "bg-[var(--ctp-green)]";
    case ActivityState.NeedsInput:
      return "bg-[var(--ctp-red)]";
    case ActivityState.Idle:
      return "bg-[var(--ctp-overlay0)]";
    default:
      return "bg-[var(--ctp-overlay0)]";
  }
}

// tabIcon removed — emoji icons replaced with activity dot for native feel

interface TabButtonProps {
  tab: PaneTab;
  paneId: string;
  isSelected: boolean;
}

export function TabButton({ tab, paneId, isSelected }: TabButtonProps) {
  const handleDragStart = (e: React.DragEvent) => {
    const data: TabDragData = {
      tabId: tab.id,
      sourcePaneId: paneId,
      tabKind: tab.kind,
      label: tab.label,
    };
    e.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
    useStore.getState().setTabDragActive(true);
  };

  const handleDragEnd = () => {
    useStore.getState().setTabDragActive(false);
  };

  const handleSelect = () => {
    selectTab(paneId, tab.id);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(paneId, tab.id);
  };

  return (
    <div
      className={`
        group relative flex items-center gap-1.5 px-3 h-full min-w-0
        cursor-pointer select-none whitespace-nowrap text-sm
        transition-colors duration-100
        ${isSelected
          ? "bg-[var(--ctp-surface0)] text-[var(--ctp-text)]"
          : "text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)]/50"
        }
      `}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleSelect}
    >
      {/* Activity indicator dot */}
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activityColor(tab)}`} />

      <span className="truncate">{tab.label}</span>

      {/* Close button — visible on hover, macOS-style */}
      <button
        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-[10px] text-[var(--ctp-overlay0)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-opacity"
        onClick={handleClose}
      >
        {"×"}
      </button>

      {/* Progress bar — thin line at bottom of tab */}
      {tab.progressState != null && <ProgressBar state={tab.progressState} value={tab.progressValue ?? 0} />}
    </div>
  );
}

function progressColor(state: ProgressState): string {
  switch (state) {
    case ProgressState.Set:
      return "bg-[var(--ctp-blue)]";
    case ProgressState.Error:
      return "bg-[var(--ctp-red)]";
    case ProgressState.Pause:
      return "bg-[var(--ctp-yellow)]";
    case ProgressState.Indeterminate:
      return "bg-[var(--ctp-blue)]";
    default:
      return "bg-[var(--ctp-blue)]";
  }
}

function ProgressBar({ state, value }: { state: ProgressState; value: number }) {
  const color = progressColor(state);
  const isIndeterminate = state === ProgressState.Indeterminate;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--ctp-surface0)]">
      <div
        className={`h-full ${color} ${isIndeterminate ? "animate-pulse" : ""} transition-[width] duration-200`}
        style={{ width: isIndeterminate ? "100%" : `${value}%` }}
      />
    </div>
  );
}
