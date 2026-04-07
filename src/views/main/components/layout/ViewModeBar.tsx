import { useCallback } from "react";
import { ViewMode } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";

function HttpServerIcon() {
  const httpEnabled = useStore((s) => s.config?.httpServer?.enabled ?? false);
  const httpServerRunning = useStore((s) => s.httpServerRunning);
  const httpServerError = useStore((s) => s.httpServerError);
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  const hasError = httpEnabled && !httpServerRunning && !!httpServerError;
  const arcColor = hasError
    ? "var(--ctp-red)"
    : httpServerRunning
      ? "var(--ctp-blue)"
      : "var(--ctp-overlay0)";
  const arcOpacity = httpServerRunning ? 0.6 : 1;
  const towerColor = hasError
    ? "var(--ctp-red)"
    : httpServerRunning
      ? "var(--ctp-subtext0)"
      : "var(--ctp-overlay0)";

  const title = hasError
    ? `HTTP server error: ${httpServerError}`
    : httpServerRunning
      ? "HTTP server enabled"
      : "HTTP server disabled";

  return (
    <button
      onClick={() => openSettingsTab("remote")}
      className="electrobun-webkit-app-region-no-drag p-1 rounded transition-colors hover:bg-[var(--ctp-surface0)]"
      title={title}
    >
      <svg
        className="w-6 h-6"
        viewBox="0 0 28 28"
        fill="none"
      >
        {/* Outer arc */}
        <path
          d="M5.34 20 A 10 10 0 1 1 22.66 20"
          stroke={arcColor}
          opacity={arcOpacity}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Inner arc */}
        <path
          d="M8.8 18 A 6 6 0 1 1 19.2 18"
          stroke={arcColor}
          opacity={arcOpacity}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Head circle + tower body (keyhole shape) */}
        <circle cx="14" cy="15" r="2.5" fill={towerColor} />
        <path d="M12 16.5l-1.5 8h7L16 16.5" fill={towerColor} />
      </svg>
    </button>
  );
}

interface ViewModeBarProps {
  workspacePath: string | null;
}

const workspaceModes: { mode: ViewMode; label: string }[] = [
  { mode: ViewMode.Dashboard, label: "Dashboard" },
  { mode: ViewMode.Terminal, label: "Terminal" },
  { mode: ViewMode.Diff, label: "Diff View" },
  { mode: ViewMode.VCS, label: "VCS" },
];

export function ViewModeBar({ workspacePath }: ViewModeBarProps) {
  const viewMode = useStore(
    (s) => workspacePath ? (s.workspaceViewMode[workspacePath] ?? ViewMode.Terminal) : ViewMode.Terminal,
  );
  const setViewMode = useStore((s) => s.setViewMode);
  const progressActive = useStore((s) => s.progressViewActive);
  const setProgressActive = useStore((s) => s.setProgressViewActive);

  const handleSelectWorkspaceMode = useCallback(
    (mode: ViewMode) => {
      if (progressActive) setProgressActive(false);
      if (workspacePath) setViewMode(workspacePath, mode);
    },
    [workspacePath, setViewMode, progressActive, setProgressActive],
  );

  const handleToggleProgress = useCallback(() => {
    setProgressActive(!progressActive);
  }, [progressActive, setProgressActive]);

  return (
    <div
      className="electrobun-webkit-app-region-drag flex items-center pt-2.5 pb-1.5 flex-shrink-0 px-4"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div className="flex-1" />
      <div
        className="electrobun-webkit-app-region-no-drag flex items-center rounded-full overflow-hidden border border-[var(--ctp-surface0)]"
        style={{ backgroundColor: "var(--ctp-crust)" }}
      >
        {/* Progress pill — always first */}
        <button
          onClick={handleToggleProgress}
          className="px-4 py-2 text-xs font-medium rounded-full transition-colors duration-100"
          style={{
            backgroundColor: progressActive ? "var(--ctp-surface0)" : "transparent",
            color: "var(--ctp-text)",
          }}
        >
          Progress
        </button>
        {/* Workspace view mode pills */}
        {workspaceModes.map(({ mode, label }) => {
          const isActive = !progressActive && viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleSelectWorkspaceMode(mode)}
              className="px-4 py-2 text-xs font-medium rounded-full transition-colors duration-100"
              style={{
                backgroundColor: isActive ? "var(--ctp-surface0)" : "transparent",
                color: progressActive ? "var(--ctp-overlay1)" : "var(--ctp-text)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 flex justify-end">
        <HttpServerIcon />
      </div>
    </div>
  );
}
