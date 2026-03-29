// ============================================================
// ViewModeBar — Compact segmented control for switching between
// Terminal, Diff, and Dashboard view modes per workspace.
// Matches the Swift Tempest toolbar picker pattern.
// ============================================================

import { useCallback } from "react";
import { ViewMode } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";

interface ViewModeBarProps {
  workspacePath: string;
}

const modes: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: ViewMode.Terminal, label: "Terminal", icon: "terminal" },
  { mode: ViewMode.Diff, label: "Diff", icon: "diff" },
  { mode: ViewMode.Dashboard, label: "Dashboard", icon: "dashboard" },
];

function TerminalIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity={active ? 1 : 0.7}>
      <path d="M2.5 3L7 7.5 2.5 12l1 1L9 7.5 3.5 2l-1 1zM8 13h5.5v-1H8v1z" />
    </svg>
  );
}

function DiffIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity={active ? 1 : 0.7}>
      <path d="M2 3h5v1H2V3zm0 3h8v1H2V6zm0 3h5v1H2V9zm0 3h8v1H2v-1zm9-9v3h3V3h-3zm2 2h-1V4h1v1zm-2 3v3h3V8h-3zm2 2h-1V9h1v1z" />
    </svg>
  );
}

function DashboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity={active ? 1 : 0.7}>
      <path d="M3 2h4v5H3V2zm0 7h4v5H3V9zm6-7h4v5H9V2zm0 7h4v5H9V9z" />
    </svg>
  );
}

function iconForMode(mode: ViewMode, active: boolean) {
  switch (mode) {
    case ViewMode.Terminal:
      return <TerminalIcon active={active} />;
    case ViewMode.Diff:
      return <DiffIcon active={active} />;
    case ViewMode.Dashboard:
      return <DashboardIcon active={active} />;
  }
}

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
      className="flex items-center gap-0.5 px-2 py-1 flex-shrink-0"
      style={{
        borderBottom: "1px solid var(--ctp-surface0)",
        backgroundColor: "var(--ctp-mantle)",
      }}
    >
      <div
        className="flex items-center rounded-md overflow-hidden"
        style={{
          backgroundColor: "var(--ctp-crust)",
          border: "1px solid var(--ctp-surface0)",
        }}
      >
        {modes.map(({ mode, label }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleSelect(mode)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors duration-100"
              style={{
                backgroundColor: isActive
                  ? "var(--ctp-surface0)"
                  : "transparent",
                color: isActive ? "var(--ctp-blue)" : "var(--ctp-subtext0)",
                borderRight:
                  mode !== ViewMode.Dashboard
                    ? "1px solid var(--ctp-surface0)"
                    : "none",
              }}
            >
              {iconForMode(mode, isActive)}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
