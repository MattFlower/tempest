import { useStore } from "../../state/store";
import type { SidebarView } from "../../../../shared/ipc-types";
import { toggleRunPane, hydrateRunPaneForWorkspace } from "../../state/run-pane-actions";
import { useEffect } from "react";

interface IconButtonProps {
  view: SidebarView;
  title: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ view: _view, title, isActive, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      onClick={onClick}
      className={[
        "relative w-8 h-8 flex items-center justify-center rounded transition-colors",
        isActive
          ? "bg-[var(--ctp-surface0)] text-[var(--ctp-text)]"
          : "text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)]/50",
      ].join(" ")}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
          style={{ backgroundColor: "var(--ctp-blue)" }}
        />
      )}
      {children}
    </button>
  );
}

export function ActivityBar() {
  const activeView = useStore((s) => s.activeSidebarView);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const activateView = useStore((s) => s.activateSidebarView);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const runPaneVisible = useStore((s) =>
    selectedWorkspacePath ? (s.runPaneVisible[selectedWorkspacePath] ?? false) : false,
  );

  useEffect(() => {
    if (selectedWorkspacePath) {
      hydrateRunPaneForWorkspace(selectedWorkspacePath);
    }
  }, [selectedWorkspacePath]);

  const isActive = (view: SidebarView) => sidebarVisible && activeView === view;
  const runButtonDisabled = !selectedWorkspacePath;

  return (
    <div
      className="flex flex-col items-center flex-shrink-0 py-2 gap-1 border-r"
      style={{
        width: 40,
        backgroundColor: "var(--ctp-crust)",
        borderColor: "var(--ctp-surface0)",
      }}
    >
      <IconButton
        view="workspaces"
        title="Workspaces"
        isActive={isActive("workspaces")}
        onClick={() => activateView("workspaces")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="7" height="7" rx="1" />
          <rect x="14" y="4" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </IconButton>
      <IconButton
        view="files"
        title="Files"
        isActive={isActive("files")}
        onClick={() => activateView("files")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 6a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.4.6l1.4 1.4h7.9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
        </svg>
      </IconButton>

      <div className="mt-auto flex flex-col items-center gap-1 w-full">
        <div className="w-5 h-px" style={{ backgroundColor: "var(--ctp-surface0)" }} aria-hidden />
        <button
          type="button"
          title="Toggle Run pane"
          aria-label="Toggle Run pane"
          aria-pressed={runPaneVisible}
          disabled={runButtonDisabled}
          onClick={() => selectedWorkspacePath && toggleRunPane(selectedWorkspacePath)}
          className={[
            "relative w-8 h-8 flex items-center justify-center rounded transition-colors",
            runButtonDisabled
              ? "text-[var(--ctp-overlay0)] cursor-not-allowed"
              : runPaneVisible
                ? "bg-[var(--ctp-surface0)] text-[var(--ctp-green)]"
                : "text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)]/50",
          ].join(" ")}
        >
          {runPaneVisible && (
            <span
              aria-hidden
              className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
              style={{ backgroundColor: "var(--ctp-green)" }}
            />
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M10 9 L15 12 L10 15 Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
