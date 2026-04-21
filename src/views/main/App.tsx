import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useStore } from "./state/store";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ActivityBar } from "./components/sidebar/ActivityBar";
import { CommandPalette } from "./components/palette/CommandPalette";
import { CreateClaudeSettingsDialog } from "./components/palette/CreateClaudeSettingsDialog";
import { WorkspaceDetail } from "./components/layout";
import { ViewModeBar } from "./components/layout/ViewModeBar";
import { ProgressView } from "./components/progress/ProgressView";
import { OnboardingDialog } from "./components/onboarding/OnboardingDialog";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { UsageFooter } from "./components/usage/UsageFooter";
import { RunPane } from "./components/runpane/RunPane";
import { api } from "./state/rpc-client";
import { fromNodeState } from "./models/pane-node";
import type { ActivityState, AppConfig } from "../../shared/ipc-types";
import { applyTheme } from "./state/theme";
import { mountDevTools } from "./state/devtools";
import { installKeybindingDispatcher, subscribePendingChord } from "./keybindings/dispatcher";
import { formatKeystroke } from "./keybindings/keystroke";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;

export function App() {
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const paneTrees = useStore((s) => s.paneTrees);
  const config = useStore((s) => s.config);
  const settingsDialogVisible = useStore((s) => s.settingsDialogVisible);
  const progressViewActive = useStore((s) => s.progressViewActive);
  const devtoolsVisible = useStore((s) => s.devtoolsVisible);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load config on startup and decide if onboarding is needed
  useEffect(() => {
    api.getConfig().then((cfg: AppConfig) => {
      useStore.getState().setConfig(cfg);
      applyTheme(cfg.theme ?? "dark");
      if (!cfg.workspaceRoot || cfg.workspaceRoot.trim() === "") {
        setShowOnboarding(true);
      }
      setConfigLoaded(true);
    }).catch(() => {
      setShowOnboarding(true);
      setConfigLoaded(true);
    });
    api.getHttpServerStatus().then((status: any) => {
      useStore.getState().setHttpServerStatus(status.running, status.error);
    });
    // Sync activity state that may have accumulated before webview was ready
    api.getActivityState().then((states: Record<string, ActivityState>) => {
      const store = useStore.getState();
      for (const [path, state] of Object.entries(states)) {
        store.setWorkspaceActivity(path, state);
      }
    }).catch(() => { /* activity tracker not ready yet */ });
  }, []);

  // All workspace paths to render: selected + any with existing trees
  const allWorkspacePaths = useMemo(() => {
    const paths = new Set(Object.keys(paneTrees));
    if (selectedWorkspacePath) paths.add(selectedWorkspacePath);
    return Array.from(paths);
  }, [paneTrees, selectedWorkspacePath]);

  // Restore session state on startup
  useEffect(() => {
    api.loadSessionState().then((state: any) => {
      if (!state) return;
      const store = useStore.getState();

      // Restore pane trees for each workspace
      for (const [wsPath, wsPaneState] of Object.entries(state.workspaces)) {
        const ws = wsPaneState as any;
        if (ws.paneTree) {
          const tree = fromNodeState(ws.paneTree);
          store.setPaneTree(wsPath, tree);
        }
      }

      // Restore selected workspace
      if (state.selectedWorkspacePath) {
        store.selectWorkspace(state.selectedWorkspacePath);
      }

      // Restore file tree state (activeSidebarView, expanded sets, cursor).
      if (state.fileTree) {
        store.hydrateFileTree(state.fileTree);
      }

      console.log(
        "[App] Session restored:",
        Object.keys(state.workspaces).length,
        "workspaces",
      );
    }).catch((err: any) => {
      console.error("[App] Session restore failed:", err);
    });
  }, []);

  // Persist file tree state changes. Debounced so rapid expand/collapse
  // sequences don't spam the backend. The Bun process auto-flushes the
  // session file every 30s on top of this.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      const s = useStore.getState();
      api.saveFileTreeState({
        activeSidebarView: s.activeSidebarView,
        expandedRepoIds: Object.keys(s.fileTreeExpandedRepos),
        expandedWorkspacePaths: Object.keys(s.fileTreeExpandedWorkspaces),
        expandedDirs: Object.keys(s.fileTreeExpandedDirs),
        cursor: s.fileTreeCursor,
        scrollTop: s.fileTreeScrollTop,
        showHidden: s.fileTreeShowHidden,
      }).catch(() => { /* swallow */ });
    };
    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.activeSidebarView === prev.activeSidebarView &&
        s.fileTreeExpandedRepos === prev.fileTreeExpandedRepos &&
        s.fileTreeExpandedWorkspaces === prev.fileTreeExpandedWorkspaces &&
        s.fileTreeExpandedDirs === prev.fileTreeExpandedDirs &&
        s.fileTreeCursor === prev.fileTreeCursor &&
        s.fileTreeScrollTop === prev.fileTreeScrollTop &&
        s.fileTreeShowHidden === prev.fileTreeShowHidden
      ) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 250);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Install the global keybinding dispatcher once. Bindings come from the
  // command registry (src/views/main/commands/registry.ts) overlaid with
  // user overrides from config.keybindings — the dispatcher hot-reloads when
  // those overrides change.
  useEffect(() => {
    installKeybindingDispatcher();
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const sidebarDragRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const cleanupSidebarDrag = useCallback(() => {
    if (sidebarDragRef.current) {
      document.removeEventListener("mousemove", sidebarDragRef.current.move);
      document.removeEventListener("mouseup", sidebarDragRef.current.up);
      sidebarDragRef.current = null;
    }
    setIsDragging(false);
  }, []);

  // Safety: clean up on window blur or component unmount
  useEffect(() => {
    window.addEventListener("blur", cleanupSidebarDrag);
    return () => {
      window.removeEventListener("blur", cleanupSidebarDrag);
      cleanupSidebarDrag();
    };
  }, [cleanupSidebarDrag]);



  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;

      const move = (ev: MouseEvent) => {
        const newWidth = startWidth.current + (ev.clientX - startX.current);
        setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)));
      };
      const up = () => cleanupSidebarDrag();

      sidebarDragRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [sidebarWidth, setSidebarWidth, cleanupSidebarDrag]
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Onboarding dialog — shown on first launch */}
      {showOnboarding && configLoaded && (
        <OnboardingDialog
          defaultRoot={config?.workspaceRoot ?? ""}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Top bar — sidebar toggle on the left, HTTP server indicator on the right.
          Workspace mode controls (Progress / Dashboard / VCS) live in the left
          ActivityBar; see components/sidebar/ActivityBar.tsx. */}
      <ViewModeBar />

      {/* Accent line below view mode bar */}
      <div className="h-px flex-shrink-0" style={{ backgroundColor: "var(--ctp-surface0)" }} />

      {/* Main content area — starts below accent line.
          The ActivityBar sits at the left edge and stays visible/clickable in
          every mode (including Progress) so the user can always switch views.
          The sidebar + workspace stack is hidden (opacity + pointer-events) when
          Progress is active, and the ProgressView overlays that region. */}
      <div className="flex flex-1 min-h-0">
        {/* Activity bar — always visible, even during Progress view or when the
            wider sidebar panel is collapsed. */}
        <ActivityBar />

        <div className="flex-1 min-w-0 relative">
          <div
            className={`absolute inset-0 flex ${
              progressViewActive ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            {/* Sidebar */}
            {sidebarVisible && (
              <>
                <div
                  className="flex-shrink-0"
                  style={{ width: sidebarWidth }}
                >
                  <Sidebar />
                </div>

                {/* Draggable divider */}
                <div
                  className="w-px flex-shrink-0 cursor-col-resize"
                  style={{
                    backgroundColor: isDragging ? "var(--ctp-surface2)" : "var(--ctp-surface0)",
                    opacity: isDragging ? 1 : 0.5,
                    padding: "0 2px",
                    margin: "0 -2px",
                  }}
                  onMouseDown={onDividerMouseDown}
                />
              </>
            )}

            {/* Workspace Detail — all visited workspaces rendered simultaneously,
                hidden with opacity pattern to preserve terminal state.
                Column is split vertically: workspace views fill the top area,
                the Run pane docks under them (spanning only the main content
                width, not the sidebar). */}
            <div className="flex-1 min-w-0 flex flex-col relative">
              <div className="flex-1 min-h-0 relative">
                {/* Workspace views — stacked, only selected is visible.
                    Includes selected workspace (even if no tree yet) plus all
                    previously visited workspaces (to keep their terminals alive). */}
                {allWorkspacePaths.map((wsPath) => (
                  <div
                    key={wsPath}
                    className={`absolute inset-0 ${
                      wsPath === selectedWorkspacePath
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none"
                    }`}
                  >
                    <WorkspaceDetail workspacePath={wsPath} />
                  </div>
                ))}

                {/* Empty state — shown when no workspace selected */}
                {!selectedWorkspacePath && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--ctp-overlay0)]">
                    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
                      <path d="M4 17.27V4h16v13.27l-2-1.15-2 1.15-2-1.15-2 1.15-2-1.15-2 1.15-2-1.15-2 1.15ZM2 2v18l4-2.3 2 1.15 2-1.15 2 1.15 2-1.15 2 1.15 2-1.15L22 20V2H2Z" />
                    </svg>
                    <span className="text-sm">No Workspace Selected</span>
                    <span className="text-xs">Select a workspace from the sidebar or create a new one.</span>
                  </div>
                )}
              </div>

              {/* Run panes — one per visited workspace, stacked in the column
                  flex. Non-selected workspaces collapse to height 0 so their
                  RunPane (and the xterm instances inside) stay mounted and keep
                  receiving script output across workspace switches. */}
              {allWorkspacePaths.map((wsPath) => (
                <div
                  key={wsPath}
                  style={{
                    height: wsPath === selectedWorkspacePath ? "auto" : 0,
                    overflow: "hidden",
                  }}
                >
                  <RunPane workspacePath={wsPath} />
                </div>
              ))}
            </div>
          </div>

          {/* Progress view overlay — mounted only while active. Overlays the
              sidebar + workspace region but leaves the ActivityBar (to its
              left) untouched, so the user can switch views from here. */}
          {progressViewActive && (
            <div className="absolute inset-0 flex">
              <ProgressView />
            </div>
          )}
        </div>
      </div>

      {/* Developer tools pane — docks eruda inline above the footer */}
      <DevToolsPane visible={devtoolsVisible} />

      {/* Usage footer — token counts and costs */}
      <UsageFooter />

      {/* Chord-in-progress indicator (e.g. "⌘K…" while waiting for a chord's second key) */}
      <ChordIndicator />

      {/* Command Palette overlay */}
      <CommandPalette />

      {/* Settings dialog */}
      {settingsDialogVisible && <SettingsDialog />}

      {/* Create Claude settings dialog */}
      <CreateClaudeSettingsDialog />
    </div>
  );
}

function ChordIndicator() {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => subscribePendingChord(setPending), []);
  if (!pending) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-50 rounded-md px-3 py-1.5 text-xs font-mono shadow-lg pointer-events-none"
      style={{
        backgroundColor: "var(--ctp-surface1)",
        color: "var(--ctp-text)",
        border: "1px solid var(--ctp-surface2)",
        letterSpacing: "0.15em",
      }}
    >
      {formatKeystroke(pending)}<span style={{ opacity: 0.5 }}> …</span>
    </div>
  );
}

// Host element for eruda's inline-mode dev tools. Stays mounted once the
// user opens devtools for the first time (eruda.init() attaches a shadow
// root to the container, so unmounting it would orphan eruda's DOM);
// toggling visibility just swaps the height between 50vh and 0.
//
// The inner container is `position: relative` to anchor eruda's internal
// `._container` element — which we override to `position: absolute` via a
// style injected into the shadow root (see state/devtools.ts).
function DevToolsPane({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [everOpened, setEverOpened] = useState(visible);

  useEffect(() => {
    if (visible) setEverOpened(true);
  }, [visible]);

  useEffect(() => {
    if (everOpened && containerRef.current) {
      mountDevTools(containerRef.current);
    }
  }, [everOpened]);

  if (!everOpened) return null;

  return (
    <div
      className="flex-shrink-0 w-full overflow-hidden"
      style={{ height: visible ? "50vh" : 0, position: "relative" }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
