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
  { mode: ViewMode.VCS, label: "VCS" },
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
      className="electrobun-webkit-app-region-drag flex items-center justify-center pt-2.5 pb-1.5 flex-shrink-0"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div
        className="electrobun-webkit-app-region-no-drag flex items-center rounded-full overflow-hidden border border-[var(--ctp-surface0)]"
        style={{ backgroundColor: "var(--ctp-crust)" }}
      >
        {modes.map(({ mode, label }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleSelect(mode)}
              className="px-4 py-2 text-xs font-medium rounded-full transition-colors duration-100"
              style={{
                backgroundColor: isActive ? "var(--ctp-surface0)" : "transparent",
                color: "var(--ctp-text)",
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
