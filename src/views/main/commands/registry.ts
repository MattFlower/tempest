// Central command registry. Single source of truth for:
//   - Command metadata (id, label, category)
//   - Default keybinding per command
//   - Command dispatch (run fn — always uses useStore.getState(), no React context needed)
//
// Consumers: the keybinding dispatcher (matches keystrokes → commandId → run())
// and the command palette (renders a filtered list + its own palette-only "open with" entries).

import type { Keystroke } from "../keybindings/keystroke";
import { PaneTabKind, EditorType, ViewMode, type SidebarView } from "../../../shared/ipc-types";
import { useStore } from "../state/store";
import { api } from "../state/rpc-client";
import { toggleDevTools } from "../state/devtools";
import { createTab, findPane } from "../models/pane-node";
import {
  addTab,
  closeTab,
  splitPane,
  focusNextPane,
  focusPreviousPane,
  toggleMaximize,
  resetRatios,
} from "../state/actions";

export type CommandCategory =
  | "palette"
  | "tabs"
  | "panes"
  | "view"
  | "workspace"
  | "repo"
  | "claude"
  | "github"
  | "app"
  | "help";

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  defaultKeybinding?: Keystroke;
  run: () => void | Promise<void>;
  /** Palette-only metadata: true if this command can be opened in a split pane via ←/→ from the palette. */
  canOpenAsPane?: boolean;
}

function isMonacoDefault(): boolean {
  return useStore.getState().config?.editor === "monaco";
}

function addTabToFocusedPane(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  const { focusedPaneId } = useStore.getState();
  if (!focusedPaneId) return;

  const needsTerminalId =
    kind === PaneTabKind.Claude ||
    kind === PaneTabKind.Shell ||
    kind === PaneTabKind.Pi ||
    (kind === PaneTabKind.Editor &&
      overrides?.editorType !== EditorType.Monaco &&
      !(overrides?.editorType === undefined && isMonacoDefault()));

  const tab = createTab(kind, label, {
    ...(needsTerminalId ? { terminalId: crypto.randomUUID() } : {}),
    ...(kind === PaneTabKind.Browser ? { browserURL: "https://google.com" } : {}),
    ...overrides,
  });
  addTab(focusedPaneId, tab);
}

function closeFocusedTab() {
  const state = useStore.getState();
  const { focusedPaneId, paneTrees, selectedWorkspacePath } = state;
  if (!focusedPaneId || !selectedWorkspacePath) return;
  const tree = paneTrees[selectedWorkspacePath];
  if (!tree) return;
  const pane = findPane(tree, focusedPaneId);
  if (pane?.selectedTabId) closeTab(focusedPaneId, pane.selectedTabId);
}

function setViewModeForCurrentWorkspace(mode: ViewMode) {
  const { selectedWorkspacePath, setViewMode, setProgressViewActive } = useStore.getState();
  if (!selectedWorkspacePath) return;
  setProgressViewActive(false);
  setViewMode(selectedWorkspacePath, mode);
}

// Toggle a workspace view mode on or off: hitting the shortcut for the currently-
// active mode returns the workspace to Terminal, mirroring the ActivityBar icon
// behavior. Progress overlay is cleared since it overrides the mode, and the
// sidebar is closed so the Workspaces/Files icon deactivates — the five top
// activity-bar icons behave as an exclusive radio group.
function toggleViewModeForCurrentWorkspace(mode: ViewMode) {
  const state = useStore.getState();
  const { selectedWorkspacePath, setViewMode, setProgressViewActive, progressViewActive, sidebarVisible, toggleSidebar } = state;
  if (!selectedWorkspacePath) return;
  const current = state.workspaceViewMode[selectedWorkspacePath] ?? ViewMode.Terminal;
  const alreadyActive = !progressViewActive && current === mode;
  if (progressViewActive) setProgressViewActive(false);
  setViewMode(selectedWorkspacePath, alreadyActive ? ViewMode.Terminal : mode);
  if (!alreadyActive && sidebarVisible) toggleSidebar();
}

// Show a sidebar view. Clears Progress and resets viewMode to Terminal so the
// Dashboard/VCS icons deactivate — the five top activity-bar icons behave as
// an exclusive radio group. When either flag was set we force-show the chosen
// view rather than letting activateSidebarView toggle the sidebar off.
function showSidebarView(view: SidebarView) {
  const state = useStore.getState();
  const { progressViewActive, selectedWorkspacePath, workspaceViewMode, setViewMode, setProgressViewActive, setActiveSidebarView, sidebarVisible, toggleSidebar, activateSidebarView } = state;
  const currentMode = selectedWorkspacePath
    ? (workspaceViewMode[selectedWorkspacePath] ?? ViewMode.Terminal)
    : ViewMode.Terminal;
  const forceShow = progressViewActive || (!!selectedWorkspacePath && currentMode !== ViewMode.Terminal);
  if (progressViewActive) setProgressViewActive(false);
  if (selectedWorkspacePath && currentMode !== ViewMode.Terminal) {
    setViewMode(selectedWorkspacePath, ViewMode.Terminal);
  }
  if (forceShow) {
    setActiveSidebarView(view);
    if (!sidebarVisible) toggleSidebar();
    return;
  }
  activateSidebarView(view);
}

export const COMMANDS: Command[] = [
  // Palette / global toggles
  {
    id: "palette.toggle",
    label: "Show Command Palette",
    category: "palette",
    defaultKeybinding: "cmd+shift+p",
    run: () => useStore.getState().toggleCommandPalette(),
  },
  {
    id: "palette.files",
    label: "Go to File",
    category: "palette",
    defaultKeybinding: "cmd+p",
    run: () => useStore.getState().openCommandPaletteFiles(),
  },
  {
    id: "find-in-files",
    label: "Find in Files",
    category: "palette",
    defaultKeybinding: "cmd+shift+f",
    run: () => useStore.getState().toggleFindInFiles(),
  },

  // Tabs
  {
    id: "new-claude",
    label: "Claude",
    category: "tabs",
    defaultKeybinding: "cmd+t",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude"),
  },
  {
    id: "new-pi",
    label: "Pi",
    category: "tabs",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.Pi, "Pi"),
  },
  {
    id: "new-shell",
    label: "New Shell Tab",
    category: "tabs",
    defaultKeybinding: "cmd+enter",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.Shell, "Shell"),
  },
  {
    id: "new-browser",
    label: "Browser",
    category: "tabs",
    defaultKeybinding: "cmd+shift+b",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.Browser, "Browser"),
  },
  {
    id: "history",
    label: "Chat History",
    category: "tabs",
    defaultKeybinding: "cmd+shift+h",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.HistoryViewer, "History"),
  },
  {
    id: "pr-dashboard",
    label: "PR Review Dashboard",
    category: "tabs",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.PRDashboard, "PR Reviews"),
  },
  {
    id: "close-tab",
    label: "Close Tab",
    category: "tabs",
    defaultKeybinding: "cmd+w",
    run: closeFocusedTab,
  },

  // Panes
  {
    id: "split-pane",
    label: "Split Pane",
    category: "panes",
    defaultKeybinding: "cmd+d",
    run: () => splitPane("right"),
  },
  {
    id: "focus-next",
    label: "Focus Next Pane",
    category: "panes",
    defaultKeybinding: "cmd+]",
    run: focusNextPane,
  },
  {
    id: "focus-prev",
    label: "Focus Previous Pane",
    category: "panes",
    defaultKeybinding: "cmd+[",
    run: focusPreviousPane,
  },
  {
    id: "focus-left",
    label: "Focus Pane Left",
    category: "panes",
    defaultKeybinding: "cmd+alt+left",
    run: focusPreviousPane,
  },
  {
    id: "focus-right",
    label: "Focus Pane Right",
    category: "panes",
    defaultKeybinding: "cmd+alt+right",
    run: focusNextPane,
  },
  {
    id: "toggle-maximize",
    label: "Toggle Maximize Pane",
    category: "panes",
    defaultKeybinding: "cmd+shift+enter",
    run: toggleMaximize,
  },
  {
    id: "reset-ratios",
    label: "Reset Pane Sizes",
    category: "panes",
    defaultKeybinding: "cmd+shift+=",
    run: resetRatios,
  },

  // View modes — keybindings match top-to-bottom order of the left activity bar:
  //   ⌘1 Workspaces · ⌘2 Files · ⌘3 Progress · ⌘4 Dashboard · ⌘5 VCS.
  // The Run-pane button deliberately has no default keybinding.
  {
    id: "sidebar.workspaces",
    label: "Show Workspaces",
    category: "view",
    defaultKeybinding: "cmd+1",
    run: () => showSidebarView("workspaces"),
  },
  {
    id: "sidebar.files",
    label: "Show Files",
    category: "view",
    defaultKeybinding: "cmd+2",
    run: () => showSidebarView("files"),
  },
  {
    id: "toggle-progress-view",
    label: "Toggle Progress View",
    category: "view",
    defaultKeybinding: "cmd+3",
    run: () => {
      const store = useStore.getState();
      store.setProgressViewActive(!store.progressViewActive);
    },
  },
  {
    id: "dashboard-view",
    label: "Toggle Dashboard View",
    category: "view",
    defaultKeybinding: "cmd+4",
    run: () => toggleViewModeForCurrentWorkspace(ViewMode.Dashboard),
  },
  {
    id: "vcs-view",
    label: "Toggle VCS View",
    category: "view",
    defaultKeybinding: "cmd+5",
    run: () => toggleViewModeForCurrentWorkspace(ViewMode.VCS),
  },
  {
    id: "terminal-view",
    label: "Terminal View",
    category: "view",
    // No default keybinding — Terminal is reachable by toggling off VCS / Dashboard
    // or by switching sidebar views. This command remains available via the palette.
    run: () => setViewModeForCurrentWorkspace(ViewMode.Terminal),
  },

  // Repos
  {
    id: "add-repo",
    label: "Add Repository",
    category: "repo",
    run: async () => {
      const result = await api.browseDirectory("~/");
      if (!result.path) return;
      await api.addRepo(result.path);
      const repos = await api.getRepos();
      useStore.getState().setRepos(repos);
      for (const repo of repos) {
        const ws = await api.getWorkspaces(repo.id);
        useStore.getState().setWorkspaces(repo.id, ws);
      }
    },
  },
  {
    id: "clone-repo",
    label: "Add Remote Repository",
    category: "repo",
    run: () => useStore.getState().showCloneRepoDialog(),
  },

  // Claude
  {
    id: "open-plan",
    label: "Open Current Plan",
    category: "claude",
    canOpenAsPane: true,
    run: async () => {
      const state = useStore.getState();
      const { focusedPaneId, paneTrees, selectedWorkspacePath } = state;
      if (!focusedPaneId || !selectedWorkspacePath) return;
      const tree = paneTrees[selectedWorkspacePath];
      if (!tree) return;
      const pane = findPane(tree, focusedPaneId);
      if (!pane) return;
      const tab = pane.tabs.find((t) => t.id === pane.selectedTabId);
      if (!tab || tab.kind !== PaneTabKind.Claude || !tab.sessionId) return;
      const result = await api.getSessionPlanPath(tab.sessionId, selectedWorkspacePath);
      if (!result.planPath) return;
      const name = result.planPath.split("/").pop() ?? "Plan";
      addTabToFocusedPane(PaneTabKind.MarkdownViewer, name, { markdownFilePath: result.planPath });
    },
  },
  {
    id: "open-user-claude-settings",
    label: "Open User Claude Settings",
    category: "claude",
    canOpenAsPane: true,
    run: async () => {
      const wsPath = useStore.getState().selectedWorkspacePath;
      const result = await api.browsePath("~/.claude/settings.json", wsPath ?? "/");
      addTabToFocusedPane(PaneTabKind.Editor, "settings.json", { editorFilePath: result.resolvedPath });
    },
  },
  {
    id: "open-workspace-claude-settings",
    label: "Open Workspace Claude Settings",
    category: "claude",
    canOpenAsPane: true,
    run: async () => {
      const wsPath = useStore.getState().selectedWorkspacePath;
      if (!wsPath) return;
      const settingsPath = `${wsPath}/.claude/settings.json`;
      const result = await api.browsePath(settingsPath, wsPath);
      if (result.kind === "file") {
        addTabToFocusedPane(PaneTabKind.Editor, "settings.json", { editorFilePath: settingsPath });
        return;
      }
      useStore.getState().showCreateClaudeSettingsDialog({
        path: settingsPath,
        onConfirm: async () => {
          await api.writeFileForEditor(settingsPath, "{}\n");
          addTabToFocusedPane(PaneTabKind.Editor, "settings.json", { editorFilePath: settingsPath });
        },
      });
    },
  },

  // GitHub
  {
    id: "open-repo-in-browser",
    label: "Open Repo in Browser",
    category: "github",
    canOpenAsPane: true,
    run: async () => {
      const wsPath = useStore.getState().selectedWorkspacePath;
      if (!wsPath) return;
      const result = await api.getRepoGitHubUrl(wsPath);
      if ("error" in result) return;
      addTabToFocusedPane(PaneTabKind.Browser, "GitHub", { browserURL: result.url });
    },
  },
  {
    id: "view-pr-in-browser",
    label: "View PR in Browser",
    category: "github",
    canOpenAsPane: true,
    run: async () => {
      const wsPath = useStore.getState().selectedWorkspacePath;
      if (!wsPath) return;
      const cached = await api.getOpenPRState(wsPath);
      if (cached?.prURL) {
        addTabToFocusedPane(PaneTabKind.Browser, "PR", { browserURL: cached.prURL });
        return;
      }
      const result = await api.lookupPRUrl(wsPath);
      if ("error" in result) return;
      addTabToFocusedPane(PaneTabKind.Browser, "PR", { browserURL: result.url });
      api.setOpenPRState(wsPath, { prURL: result.url });
    },
  },

  // App chrome
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    category: "app",
    run: () => useStore.getState().toggleSidebar(),
  },
  {
    id: "toggle-devtools",
    label: "Toggle Developer Tools",
    category: "app",
    defaultKeybinding: "cmd+alt+i",
    run: () => toggleDevTools(),
  },

  // Help
  {
    id: "help.keymap",
    label: "Keyboard Shortcuts",
    category: "help",
    canOpenAsPane: true,
    run: () => addTabToFocusedPane(PaneTabKind.KeymapHelp, "Keymap"),
  },
];

const COMMAND_BY_ID = new Map(COMMANDS.map((cmd) => [cmd.id, cmd]));

export function getCommand(id: string): Command | undefined {
  return COMMAND_BY_ID.get(id);
}

/** Resolve effective `keystroke → commandId` mapping by overlaying user overrides on defaults.
 *  Overrides set to `null` remove the default binding. */
export function effectiveBindings(
  overrides: Record<string, string | null> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cmd of COMMANDS) {
    const override = overrides?.[cmd.id];
    let stroke: string | null | undefined;
    if (override === undefined) stroke = cmd.defaultKeybinding;
    else stroke = override;
    if (stroke) map.set(stroke, cmd.id);
  }
  return map;
}

/** Resolve the effective keystroke for a single command, given the current overrides. */
export function effectiveKeystrokeFor(
  commandId: string,
  overrides: Record<string, string | null> | undefined,
): string | null {
  const cmd = COMMAND_BY_ID.get(commandId);
  if (!cmd) return null;
  const override = overrides?.[commandId];
  if (override === undefined) return cmd.defaultKeybinding ?? null;
  return override; // may be null (explicitly unbound) or a string
}
