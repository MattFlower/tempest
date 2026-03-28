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

function tabIcon(kind: PaneTabKind): string {
  switch (kind) {
    case PaneTabKind.Browser:
      return "\u{1F310}"; // globe
    case PaneTabKind.Shell:
      return "$";
    case PaneTabKind.Claude:
      return "\u{2728}"; // sparkles
    case PaneTabKind.HistoryViewer:
      return "\u{1F4CB}"; // clipboard
    case PaneTabKind.MarkdownViewer:
      return "\u{1F4C4}"; // page
    case PaneTabKind.Editor:
      return "\u{270F}\u{FE0F}"; // pencil
    default:
      return "";
  }
}

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
        group relative flex items-center gap-1 px-3 h-full
        cursor-pointer select-none whitespace-nowrap text-xs
        hover:bg-[var(--ctp-surface0)]
        ${isSelected ? "text-[var(--ctp-text)]" : "text-[var(--ctp-subtext0)]"}
      `}
      draggable
      onDragStart={handleDragStart}
      onClick={handleSelect}
    >
      {/* Activity indicator */}
      {tab.kind === PaneTabKind.Browser ? (
        <span className="text-[10px] opacity-60">{tabIcon(tab.kind)}</span>
      ) : (
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activityColor(tab)}`} />
      )}

      <span>{tab.label}</span>

      {/* Close button */}
      <button
        className="ml-1 opacity-0 group-hover:opacity-100 text-[var(--ctp-overlay0)] hover:text-[var(--ctp-red)] transition-opacity"
        onClick={handleClose}
      >
        \u00D7
      </button>

      {/* Selected underline */}
      {isSelected && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--ctp-blue)]" />
      )}
    </div>
  );
}
