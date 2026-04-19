import type { RunTab } from "../../models/run-tab";

interface RunPaneToolbarProps {
  activeTab: RunTab | null;
  onRestart: () => void;
  onStop: () => void;
  onHide: () => void;
}

function ToolbarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        "w-6 h-6 flex items-center justify-center rounded",
        disabled
          ? "text-[var(--ctp-overlay0)] cursor-not-allowed"
          : "text-[var(--ctp-subtext1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function RunPaneToolbar({ activeTab, onRestart, onStop, onHide }: RunPaneToolbarProps) {
  const canStop = activeTab?.status === "running";
  const canRestart = !!activeTab;

  return (
    <div
      className="flex items-center gap-1 px-2 h-7 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      <span className="text-xs text-[var(--ctp-subtext0)] mr-2">Run</span>
      <ToolbarButton title="Restart" disabled={!canRestart} onClick={onRestart}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      </ToolbarButton>
      <ToolbarButton title="Stop" disabled={!canStop} onClick={onStop}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="2" y="2" width="8" height="8" rx="1" />
        </svg>
      </ToolbarButton>
      <div className="flex-1" />
      <ToolbarButton title="Hide Run pane" onClick={onHide}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </ToolbarButton>
    </div>
  );
}
