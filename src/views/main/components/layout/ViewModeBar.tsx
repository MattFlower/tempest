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

export function ViewModeBar() {
  // Padding is tuned so the bar's icons vertically line up with macOS's native
  // red/yellow/green traffic lights. Their Y is set explicitly by
  // win.setWindowButtonPosition(...) in src/bun/index.ts; pt/pb here fine-tune
  // the icon Y to match. pl-[72px] on the left container reserves horizontal
  // space for those traffic lights.
  return (
    <div
      className="electrobun-webkit-app-region-drag flex items-center pt-2 pb-1 flex-shrink-0 px-4"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div className="flex-1 pl-[72px]" />
      <div className="flex-1 flex justify-end">
        <HttpServerIcon />
      </div>
    </div>
  );
}
