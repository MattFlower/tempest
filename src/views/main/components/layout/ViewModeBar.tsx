import { useCallback } from "react";
import { ViewMode } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";

interface ViewModeBarProps {
  workspacePath: string;
}

const modes: { mode: ViewMode; label: string }[] = [
  { mode: ViewMode.Dashboard, label: "Dashboard" },
  { mode: ViewMode.Terminal, label: "Terminal" },
  { mode: ViewMode.Diff, label: "Diff View" },
];

export function ViewModeBar({ workspacePath }: ViewModeBarProps) {
  const viewMode = useStore(
    (s) => s.workspaceViewMode[workspacePath] ?? ViewMode.Terminal,
  );
  const setViewMode = useStore((s) => s.setViewMode);

  const handleSelect = useCallback(
    (mode: ViewMode) => {
      setViewMode(workspacePath, mode);
    },
    [workspacePath, setViewMode],
  );

  return (
    <div
      className="flex items-center justify-center py-3 flex-shrink-0"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div
        className="flex items-center rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--ctp-surface0)" }}
      >
        {modes.map(({ mode, label }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleSelect(mode)}
              className="px-4 py-1 text-xs font-medium rounded-full transition-colors duration-100"
              style={{
                backgroundColor: isActive ? "var(--ctp-surface1)" : "transparent",
                color: isActive ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
