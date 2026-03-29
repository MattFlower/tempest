import { ActivityState, PaneTabKind } from "../../../../shared/ipc-types";
import type { PaneTab } from "../../models/pane-node";
import { selectTab, closeTab } from "../../state/actions";

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
        group relative flex items-center gap-1.5 px-3 h-full
        cursor-pointer select-none whitespace-nowrap text-xs
        transition-colors duration-100
        ${isSelected
          ? "bg-[var(--ctp-surface0)] text-[var(--ctp-text)]"
          : "text-[var(--ctp-subtext0)] hover:bg-[var(--ctp-surface0)]/50"
        }
      `}
      draggable
      onDragStart={handleDragStart}
      onClick={handleSelect}
    >
      {/* Activity indicator dot */}
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activityColor(tab)}`} />

      <span>{tab.label}</span>

      {/* Close button — visible on hover, macOS-style */}
      <button
        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-[10px] text-[var(--ctp-overlay0)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] transition-opacity"
        onClick={handleClose}
      >
        {"×"}
      </button>
    </div>
  );
}
