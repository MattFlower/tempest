import { useStore } from "../../state/store";
import { ViewMode, type SidebarView } from "../../../../shared/ipc-types";
import { toggleRunPane, hydrateRunPaneForWorkspace } from "../../state/run-pane-actions";
import { useEffect } from "react";

type AccentColor = "blue" | "green";

interface IconButtonProps {
  title: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: AccentColor;
  children: React.ReactNode;
}

function IconButton({ title, isActive, onClick, disabled = false, accent = "blue", children }: IconButtonProps) {
  const accentVar = accent === "green" ? "var(--ctp-green)" : "var(--ctp-blue)";
  const activeText = accent === "green" ? "text-[var(--ctp-green)]" : "text-[var(--ctp-text)]";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative w-8 h-8 flex items-center justify-center rounded transition-colors",
        disabled
          ? "text-[var(--ctp-overlay0)] cursor-not-allowed"
          : isActive
            ? `bg-[var(--ctp-surface0)] ${activeText}`
            : "text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)]/50",
      ].join(" ")}
    >
      {isActive && !disabled && (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
          style={{ backgroundColor: accentVar }}
        />
      )}
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      className="w-5 h-px my-1"
      style={{ backgroundColor: "var(--ctp-surface0)" }}
      aria-hidden
    />
  );
}

export function ActivityBar() {
  const activeSidebarView = useStore((s) => s.activeSidebarView);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const activateSidebarView = useStore((s) => s.activateSidebarView);
  const setActiveSidebarView = useStore((s) => s.setActiveSidebarView);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const viewMode = useStore((s) =>
    selectedWorkspacePath
      ? (s.workspaceViewMode[selectedWorkspacePath] ?? ViewMode.Terminal)
      : ViewMode.Terminal,
  );
  const setViewMode = useStore((s) => s.setViewMode);
  const progressActive = useStore((s) => s.progressViewActive);
  const setProgressActive = useStore((s) => s.setProgressViewActive);
  const runPaneVisible = useStore((s) =>
    selectedWorkspacePath ? (s.runPaneVisible[selectedWorkspacePath] ?? false) : false,
  );

  useEffect(() => {
    if (selectedWorkspacePath) {
      hydrateRunPaneForWorkspace(selectedWorkspacePath);
    }
  }, [selectedWorkspacePath]);

  const isSidebarViewActive = (view: SidebarView) =>
    !progressActive && sidebarVisible && activeSidebarView === view;

  const handleToggleProgress = () => {
    setProgressActive(!progressActive);
  };

  // Clicking Workspaces or Files while Progress is active exits Progress and
  // force-shows the chosen sidebar view (rather than toggling the sidebar
  // closed, which is what the normal activateSidebarView does when the view is
  // already active). When Progress is not active, fall back to the usual
  // toggle-on-repeat-click behavior.
  const handleShowSidebarView = (view: SidebarView) => {
    if (progressActive) {
      setProgressActive(false);
      setActiveSidebarView(view);
      if (!sidebarVisible) toggleSidebar();
      return;
    }
    activateSidebarView(view);
  };

  // Clicking a workspace-mode icon: enter that mode (and clear Progress if set).
  // Clicking the currently-active Dashboard or VCS icon returns the workspace
  // to Terminal mode, since the Workspaces / Files icons already represent
  // Terminal mode and there's no separate Terminal pill.
  const handleSelectMode = (mode: ViewMode) => {
    if (progressActive) setProgressActive(false);
    if (!selectedWorkspacePath) return;
    const alreadyActive = !progressActive && viewMode === mode;
    setViewMode(selectedWorkspacePath, alreadyActive ? ViewMode.Terminal : mode);
  };

  const workspaceModeDisabled = !selectedWorkspacePath;
  const dashboardActive = !progressActive && viewMode === ViewMode.Dashboard;
  const vcsActive = !progressActive && viewMode === ViewMode.VCS;

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
        title="Workspaces (⌘1)"
        isActive={isSidebarViewActive("workspaces")}
        onClick={() => handleShowSidebarView("workspaces")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="7" height="7" rx="1" />
          <rect x="14" y="4" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </IconButton>
      <IconButton
        title="Files (⌘2)"
        isActive={isSidebarViewActive("files")}
        onClick={() => handleShowSidebarView("files")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 6a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.4.6l1.4 1.4h7.9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
        </svg>
      </IconButton>

      <Divider />

      <IconButton
        title="Progress (⌘3)"
        isActive={progressActive}
        onClick={handleToggleProgress}
      >
        {/* Stacked progress rows — evokes the Progress view's stage pipeline. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="14" y2="12" />
          <line x1="4" y1="17" x2="17" y2="17" />
        </svg>
      </IconButton>
      <IconButton
        title="Dashboard (⌘4)"
        isActive={dashboardActive}
        onClick={() => handleSelectMode(ViewMode.Dashboard)}
        disabled={workspaceModeDisabled}
      >
        {/* Bar chart — dashboard metrics. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="20" x2="21" y2="20" />
          <line x1="6" y1="20" x2="6" y2="13" />
          <line x1="12" y1="20" x2="12" y2="5" />
          <line x1="18" y1="20" x2="18" y2="10" />
        </svg>
      </IconButton>
      <IconButton
        title="VCS (⌘5)"
        isActive={vcsActive}
        onClick={() => handleSelectMode(ViewMode.VCS)}
        disabled={workspaceModeDisabled}
      >
        {/* Git-style branch icon. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="8" r="2" />
          <path d="M6 8v8" />
          <path d="M18 10v1a3 3 0 0 1-3 3h-5a3 3 0 0 0-3 3" />
        </svg>
      </IconButton>

      <div className="mt-auto flex flex-col items-center gap-1 w-full">
        <Divider />
        <IconButton
          title="Toggle Run pane"
          isActive={runPaneVisible}
          onClick={() => selectedWorkspacePath && toggleRunPane(selectedWorkspacePath)}
          disabled={!selectedWorkspacePath}
          accent="green"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M10 9 L15 12 L10 15 Z" fill="currentColor" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
