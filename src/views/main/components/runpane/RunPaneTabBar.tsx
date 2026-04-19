import type { RunTab } from "../../models/run-tab";

interface RunPaneTabBarProps {
  tabs: RunTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

function statusColor(tab: RunTab): string {
  if (tab.status === "running") return "var(--ctp-green)";
  if (tab.exitCode === 0) return "var(--ctp-overlay1)";
  return "var(--ctp-red)";
}

export function RunPaneTabBar({ tabs, activeTabId, onSelect, onClose }: RunPaneTabBarProps) {
  if (tabs.length === 0) return null;
  return (
    <div
      className="flex items-stretch h-7 flex-shrink-0 overflow-x-auto"
      style={{ backgroundColor: "var(--ctp-mantle)", borderBottom: "1px solid var(--ctp-surface0)" }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={[
              "group flex items-center gap-2 px-3 text-xs cursor-pointer select-none border-r",
              active
                ? "text-[var(--ctp-text)]"
                : "text-[var(--ctp-subtext0)] hover:text-[var(--ctp-text)]",
            ].join(" ")}
            style={{
              backgroundColor: active ? "var(--ctp-base)" : "transparent",
              borderRightColor: "var(--ctp-surface0)",
            }}
            onClick={() => onSelect(tab.id)}
          >
            <span
              aria-hidden
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, backgroundColor: statusColor(tab) }}
              title={
                tab.status === "running"
                  ? "Running"
                  : `Exited (code ${tab.exitCode ?? "?"})`
              }
            />
            <span className="truncate max-w-[180px]">{tab.label}</span>
            <button
              type="button"
              title="Close"
              aria-label="Close tab"
              className="w-4 h-4 flex items-center justify-center rounded text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface1)] opacity-70 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1 L9 9 M9 1 L1 9" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
