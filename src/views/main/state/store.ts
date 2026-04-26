// ============================================================
// Zustand store — central UI state for the webview process.
// Persistent state (workspaces, config) lives in the Bun process
// and is synced via RPC. UI-only state (focused pane, maximize,
// palette visibility) lives here.
// ============================================================

import { create } from "zustand";
import type { SourceRepo, TempestWorkspace, WorkspaceSidebarInfo, AppConfig } from "../models/workspace";
import { type ActivityState, ViewMode, type DirEntry, type SidebarView, type VCSStatusResult } from "../../../shared/ipc-types";
import type { PaneNode } from "../models/pane-node";
import type { RunTab } from "../models/run-tab";

export const DEFAULT_RUN_PANE_HEIGHT = 280;
export const MIN_RUN_PANE_HEIGHT = 120;

export interface CreateClaudeSettingsRequest {
  path: string;
  onConfirm: () => Promise<void> | void;
}

export interface TempestStore {
  // --- Repos & Workspaces (synced from Bun) ---
  repos: SourceRepo[];
  workspacesByRepo: Record<string, TempestWorkspace[]>; // keyed by repoId
  selectedWorkspacePath: string | null;
  sidebarInfo: Record<string, WorkspaceSidebarInfo>; // keyed by workspace path
  config: AppConfig | null;

  // --- Pane state (per workspace) ---
  paneTrees: Record<string, PaneNode>; // keyed by workspace path
  focusedPaneId: string | null;
  focusedPaneIds: Record<string, string | null>; // per-workspace focused pane cache
  maximizedPaneId: string | null;

  // --- View mode (per workspace) ---
  workspaceViewMode: Record<string, ViewMode>; // keyed by workspace path

  // --- VCS refresh nonce (per workspace) ---
  // Bumped by the vcs.refresh command (Cmd+R in VCS view); VCSView/JJView read
  // it as a useEffect dep to re-fetch status, commits, and scoped file lists.
  vcsRefreshNonce: Record<string, number>;
  bumpVcsRefresh: (workspacePath: string) => void;

  // --- Activity state (from hook events) ---
  workspaceActivity: Record<string, ActivityState>; // keyed by workspace path

  // --- Drag state ---
  isTabDragActive: boolean;
  setTabDragActive: (active: boolean) => void;
  isFileTreeDragActive: boolean;
  setFileTreeDragActive: (active: boolean) => void;

  // --- Progress view (app-level, cross-workspace) ---
  progressViewActive: boolean;
  setProgressViewActive: (active: boolean) => void;

  // --- Developer tools (eruda) — rendered as a bottom pane ---
  devtoolsVisible: boolean;
  setDevtoolsVisible: (visible: boolean) => void;

  // --- Run pane (per workspace) ---
  runPaneVisible: Record<string, boolean>;
  runPaneHeight: Record<string, number>;
  runPaneTabs: Record<string, RunTab[]>;
  runPaneActiveTabId: Record<string, string | null>;
  setRunPaneVisible: (workspacePath: string, visible: boolean) => void;
  setRunPaneHeight: (workspacePath: string, height: number) => void;
  setRunPaneTabs: (workspacePath: string, tabs: RunTab[]) => void;
  setRunPaneActiveTabId: (workspacePath: string, tabId: string | null) => void;

  // --- UI state ---
  sidebarWidth: number;
  sidebarVisible: boolean;
  activeSidebarView: SidebarView;
  commandPaletteVisible: boolean;
  commandPaletteInitialMode: "commands" | "files";
  recentFilesPaletteVisible: boolean;
  findInFilesVisible: boolean;
  settingsDialogVisible: boolean;
  settingsDialogInitialTab: "general" | "remote" | "tools" | "appearance" | "keybindings";
  cloneRepoDialogVisible: boolean;
  createClaudeSettingsRequest: CreateClaudeSettingsRequest | null;
  httpServerRunning: boolean;
  httpServerError: string | null;
  newWorkspaceRepoId: string | null;
  overlayCount: number;

  // --- File tree ---
  fileTreeExpandedRepos: Record<string, true>;
  fileTreeExpandedWorkspaces: Record<string, true>;
  fileTreeExpandedDirs: Record<string, true>;
  fileTreeEntries: Record<string, DirEntry[]>;
  fileTreeLoading: Record<string, true>;
  fileTreeError: Record<string, string>;
  fileTreeCursor: string | null;
  fileTreeScrollTop: number;
  /** When true, ignored / dotfile rows render at full opacity; otherwise they
   *  render dimmed. Nothing is actually hidden — this only affects emphasis. */
  fileTreeShowHidden: boolean;
  /** When true, the tree automatically reveals the active Monaco file
   *  whenever it changes (focused pane's active tab). Manual toggle in the
   *  Files toolbar; persisted alongside other file-tree prefs. */
  fileTreeAutoReveal: boolean;
  /** VCS status per workspace for tree decorations. Populated lazily when a
   *  workspace is expanded; kept small — only workspaces currently expanded
   *  in the tree have entries. */
  fileTreeVcsStatus: Record<string, VCSStatusResult>;

  // --- Actions (set by action creators) ---
  setRepos: (repos: SourceRepo[]) => void;
  setWorkspaces: (repoId: string, workspaces: TempestWorkspace[]) => void;
  selectWorkspace: (path: string | null) => void;
  setSidebarInfo: (path: string, info: WorkspaceSidebarInfo) => void;
  setConfig: (config: AppConfig) => void;

  setPaneTree: (workspacePath: string, tree: PaneNode) => void;
  setFocusedPaneId: (id: string | null) => void;
  setMaximizedPaneId: (id: string | null) => void;

  setViewMode: (workspacePath: string, mode: ViewMode) => void;

  setWorkspaceActivity: (path: string, state: ActivityState) => void;
  clearWorkspaceActivity: (path: string) => void;

  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setActiveSidebarView: (view: SidebarView) => void;
  activateSidebarView: (view: SidebarView) => void;

  setFileTreeExpanded: (
    kind: "repo" | "workspace" | "dir",
    key: string,
    expanded: boolean,
  ) => void;
  setFileTreeEntries: (dirPath: string, entries: DirEntry[]) => void;
  setFileTreeLoading: (dirPath: string, loading: boolean) => void;
  setFileTreeError: (dirPath: string, error: string | null) => void;
  invalidateFileTreeDir: (dirPath: string) => void;
  setFileTreeCursor: (cursor: string | null) => void;
  setFileTreeScrollTop: (scrollTop: number) => void;
  setFileTreeShowHidden: (showHidden: boolean) => void;
  setFileTreeAutoReveal: (autoReveal: boolean) => void;
  setFileTreeVcsStatus: (workspacePath: string, status: VCSStatusResult | null) => void;
  hydrateFileTree: (state: {
    activeSidebarView?: SidebarView;
    expandedRepoIds?: string[];
    expandedWorkspacePaths?: string[];
    expandedDirs?: string[];
    cursor?: string | null;
    scrollTop?: number;
    showHidden?: boolean;
    autoReveal?: boolean;
  }) => void;

  toggleCommandPalette: () => void;
  openCommandPaletteFiles: () => void;
  toggleRecentFilesPalette: () => void;
  toggleFindInFiles: () => void;
  setFindInFilesVisible: (visible: boolean) => void;
  toggleSettingsDialog: () => void;
  openSettingsTab: (tab: "general" | "remote" | "tools" | "appearance" | "keybindings") => void;
  showCloneRepoDialog: () => void;
  hideCloneRepoDialog: () => void;
  showCreateClaudeSettingsDialog: (req: CreateClaudeSettingsRequest) => void;
  hideCreateClaudeSettingsDialog: () => void;
  setHttpServerStatus: (running: boolean, error?: string | null) => void;
  migrateWorkspacePath: (oldPath: string, newPath: string) => void;
  requestNewWorkspace: (repoId: string | null) => void;
  pushOverlay: () => void;
  popOverlay: () => void;
}

export const useStore = create<TempestStore>((set) => ({
  // Initial state
  repos: [],
  workspacesByRepo: {},
  selectedWorkspacePath: null,
  sidebarInfo: {},
  config: null,

  paneTrees: {},
  focusedPaneId: null,
  focusedPaneIds: {},
  maximizedPaneId: null,

  workspaceViewMode: {},

  vcsRefreshNonce: {},
  bumpVcsRefresh: (workspacePath) =>
    set((s) => ({
      vcsRefreshNonce: {
        ...s.vcsRefreshNonce,
        [workspacePath]: (s.vcsRefreshNonce[workspacePath] ?? 0) + 1,
      },
    })),

  workspaceActivity: {},

  isTabDragActive: false,
  setTabDragActive: (active) => set({ isTabDragActive: active }),
  isFileTreeDragActive: false,
  setFileTreeDragActive: (active) => set({ isFileTreeDragActive: active }),

  progressViewActive: false,
  setProgressViewActive: (active) => set({ progressViewActive: active }),

  devtoolsVisible: false,
  setDevtoolsVisible: (visible) => set({ devtoolsVisible: visible }),

  runPaneVisible: {},
  runPaneHeight: {},
  runPaneTabs: {},
  runPaneActiveTabId: {},
  setRunPaneVisible: (workspacePath, visible) =>
    set((s) => ({ runPaneVisible: { ...s.runPaneVisible, [workspacePath]: visible } })),
  setRunPaneHeight: (workspacePath, height) => {
    const clamped = Math.max(MIN_RUN_PANE_HEIGHT, Math.min(height, window.innerHeight * 0.7));
    set((s) => ({ runPaneHeight: { ...s.runPaneHeight, [workspacePath]: clamped } }));
  },
  setRunPaneTabs: (workspacePath, tabs) =>
    set((s) => ({ runPaneTabs: { ...s.runPaneTabs, [workspacePath]: tabs } })),
  setRunPaneActiveTabId: (workspacePath, tabId) =>
    set((s) => ({ runPaneActiveTabId: { ...s.runPaneActiveTabId, [workspacePath]: tabId } })),

  sidebarWidth: 240,
  sidebarVisible: true,
  activeSidebarView: "workspaces" as const,
  commandPaletteVisible: false,
  commandPaletteInitialMode: "commands" as const,
  recentFilesPaletteVisible: false,
  findInFilesVisible: false,
  settingsDialogVisible: false,
  settingsDialogInitialTab: "general" as const,
  cloneRepoDialogVisible: false,
  createClaudeSettingsRequest: null,
  httpServerRunning: false,
  httpServerError: null,
  newWorkspaceRepoId: null,
  overlayCount: 0,

  fileTreeExpandedRepos: {},
  fileTreeExpandedWorkspaces: {},
  fileTreeExpandedDirs: {},
  fileTreeEntries: {},
  fileTreeLoading: {},
  fileTreeError: {},
  fileTreeCursor: null,
  fileTreeScrollTop: 0,
  fileTreeShowHidden: false,
  fileTreeAutoReveal: false,
  fileTreeVcsStatus: {},

  // Actions
  setRepos: (repos) => set({ repos }),
  setWorkspaces: (repoId, workspaces) =>
    set((s) => ({
      workspacesByRepo: { ...s.workspacesByRepo, [repoId]: workspaces },
    })),
  selectWorkspace: (path) => {
    set((s) => {
      let focusMap = s.focusedPaneIds;
      // Save current focus for the departing workspace
      if (s.selectedWorkspacePath) {
        focusMap = { ...focusMap, [s.selectedWorkspacePath]: s.focusedPaneId };
      }
      return {
        selectedWorkspacePath: path,
        maximizedPaneId: null,
        focusedPaneId: path ? (focusMap[path] ?? null) : null,
        focusedPaneIds: focusMap,
      };
    });
    if (path) {
      import("./rpc-client").then(({ api }) => {
        api.notifyWorkspaceOpened(path).catch(() => {});
      });
    }
  },
  setSidebarInfo: (path, info) =>
    set((s) => ({ sidebarInfo: { ...s.sidebarInfo, [path]: info } })),
  setConfig: (config) => set({ config }),

  setPaneTree: (workspacePath, tree) =>
    set((s) => ({ paneTrees: { ...s.paneTrees, [workspacePath]: tree } })),
  setFocusedPaneId: (id) =>
    set((s) => ({
      focusedPaneId: id,
      focusedPaneIds: s.selectedWorkspacePath
        ? { ...s.focusedPaneIds, [s.selectedWorkspacePath]: id }
        : s.focusedPaneIds,
    })),
  setMaximizedPaneId: (id) => set({ maximizedPaneId: id }),

  setViewMode: (workspacePath, mode) =>
    set((s) => ({ workspaceViewMode: { ...s.workspaceViewMode, [workspacePath]: mode } })),

  setWorkspaceActivity: (path, state) =>
    set((s) => ({ workspaceActivity: { ...s.workspaceActivity, [path]: state } })),
  clearWorkspaceActivity: (path) =>
    set((s) => {
      const { [path]: _, ...rest } = s.workspaceActivity;
      return { workspaceActivity: rest };
    }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setActiveSidebarView: (view) => set({ activeSidebarView: view }),
  activateSidebarView: (view) =>
    set((s) => {
      if (!s.sidebarVisible) {
        return { sidebarVisible: true, activeSidebarView: view };
      }
      if (s.activeSidebarView === view) {
        return { sidebarVisible: false };
      }
      return { activeSidebarView: view };
    }),

  setFileTreeExpanded: (kind, key, expanded) =>
    set((s) => {
      const mapKey =
        kind === "repo"
          ? "fileTreeExpandedRepos"
          : kind === "workspace"
          ? "fileTreeExpandedWorkspaces"
          : "fileTreeExpandedDirs";
      const current = s[mapKey];
      if (expanded) {
        if (current[key]) return {};
        return { [mapKey]: { ...current, [key]: true as const } } as any;
      }
      if (!current[key]) return {};
      const { [key]: _removed, ...rest } = current;
      return { [mapKey]: rest } as any;
    }),

  setFileTreeEntries: (dirPath, entries) =>
    set((s) => {
      const nextEntries = { ...s.fileTreeEntries, [dirPath]: entries };
      const { [dirPath]: _l, ...restLoading } = s.fileTreeLoading;
      const { [dirPath]: _e, ...restError } = s.fileTreeError;
      return {
        fileTreeEntries: nextEntries,
        fileTreeLoading: restLoading,
        fileTreeError: restError,
      };
    }),

  setFileTreeLoading: (dirPath, loading) =>
    set((s) => {
      if (loading) {
        if (s.fileTreeLoading[dirPath]) return {};
        return { fileTreeLoading: { ...s.fileTreeLoading, [dirPath]: true as const } };
      }
      if (!s.fileTreeLoading[dirPath]) return {};
      const { [dirPath]: _removed, ...rest } = s.fileTreeLoading;
      return { fileTreeLoading: rest };
    }),

  setFileTreeError: (dirPath, error) =>
    set((s) => {
      if (error === null) {
        if (!s.fileTreeError[dirPath]) return {};
        const { [dirPath]: _removed, ...rest } = s.fileTreeError;
        return { fileTreeError: rest };
      }
      return { fileTreeError: { ...s.fileTreeError, [dirPath]: error } };
    }),

  invalidateFileTreeDir: (dirPath) =>
    set((s) => {
      if (!(dirPath in s.fileTreeEntries)) return {};
      const { [dirPath]: _removed, ...rest } = s.fileTreeEntries;
      return { fileTreeEntries: rest };
    }),

  setFileTreeCursor: (cursor) => set({ fileTreeCursor: cursor }),
  setFileTreeScrollTop: (scrollTop) => set({ fileTreeScrollTop: scrollTop }),
  setFileTreeShowHidden: (showHidden) => set({ fileTreeShowHidden: showHidden }),
  setFileTreeAutoReveal: (autoReveal) => set({ fileTreeAutoReveal: autoReveal }),
  setFileTreeVcsStatus: (workspacePath, status) =>
    set((s) => {
      if (status === null) {
        if (!(workspacePath in s.fileTreeVcsStatus)) return {};
        const { [workspacePath]: _removed, ...rest } = s.fileTreeVcsStatus;
        return { fileTreeVcsStatus: rest };
      }
      return {
        fileTreeVcsStatus: { ...s.fileTreeVcsStatus, [workspacePath]: status },
      };
    }),

  hydrateFileTree: (state) =>
    set(() => {
      const next: Partial<TempestStore> = {};
      if (state.activeSidebarView) next.activeSidebarView = state.activeSidebarView;
      if (state.expandedRepoIds) {
        next.fileTreeExpandedRepos = Object.fromEntries(
          state.expandedRepoIds.map((id) => [id, true as const]),
        );
      }
      if (state.expandedWorkspacePaths) {
        next.fileTreeExpandedWorkspaces = Object.fromEntries(
          state.expandedWorkspacePaths.map((p) => [p, true as const]),
        );
      }
      if (state.expandedDirs) {
        next.fileTreeExpandedDirs = Object.fromEntries(
          state.expandedDirs.map((p) => [p, true as const]),
        );
      }
      if (state.cursor !== undefined) next.fileTreeCursor = state.cursor;
      if (typeof state.scrollTop === "number") next.fileTreeScrollTop = state.scrollTop;
      if (typeof state.showHidden === "boolean") next.fileTreeShowHidden = state.showHidden;
      if (typeof state.autoReveal === "boolean") next.fileTreeAutoReveal = state.autoReveal;
      return next;
    }),

  toggleCommandPalette: () =>
    set((s) => ({
      commandPaletteVisible: !s.commandPaletteVisible,
      commandPaletteInitialMode: "commands" as const,
    })),
  openCommandPaletteFiles: () =>
    set({ commandPaletteVisible: true, commandPaletteInitialMode: "files" as const }),
  toggleRecentFilesPalette: () =>
    set((s) => ({ recentFilesPaletteVisible: !s.recentFilesPaletteVisible })),
  toggleFindInFiles: () =>
    set((s) => ({ findInFilesVisible: !s.findInFilesVisible })),
  setFindInFilesVisible: (visible) => set({ findInFilesVisible: visible }),
  toggleSettingsDialog: () =>
    set((s) => ({
      settingsDialogVisible: !s.settingsDialogVisible,
      settingsDialogInitialTab: s.settingsDialogVisible ? s.settingsDialogInitialTab : "general" as const,
    })),
  openSettingsTab: (tab) =>
    set({ settingsDialogVisible: true, settingsDialogInitialTab: tab }),
  showCloneRepoDialog: () => set({ cloneRepoDialogVisible: true }),
  hideCloneRepoDialog: () => set({ cloneRepoDialogVisible: false }),
  showCreateClaudeSettingsDialog: (req) => set({ createClaudeSettingsRequest: req }),
  hideCreateClaudeSettingsDialog: () => set({ createClaudeSettingsRequest: null }),
  setHttpServerStatus: (running, error) =>
    set({ httpServerRunning: running, httpServerError: error ?? null }),
  migrateWorkspacePath: (oldPath, newPath) =>
    set((s) => {
      const result: Partial<TempestStore> = {};

      if (s.selectedWorkspacePath === oldPath) {
        result.selectedWorkspacePath = newPath;
      }
      if (s.paneTrees[oldPath]) {
        const { [oldPath]: tree, ...rest } = s.paneTrees;
        result.paneTrees = { ...rest, [newPath]: tree! };
      }
      if (s.sidebarInfo[oldPath]) {
        const { [oldPath]: info, ...rest } = s.sidebarInfo;
        result.sidebarInfo = { ...rest, [newPath]: info! };
      }
      if (s.workspaceActivity[oldPath] !== undefined) {
        const { [oldPath]: activity, ...rest } = s.workspaceActivity;
        result.workspaceActivity = { ...rest, [newPath]: activity! };
      }
      if (s.focusedPaneIds[oldPath] !== undefined) {
        const { [oldPath]: focusId, ...rest } = s.focusedPaneIds;
        result.focusedPaneIds = { ...rest, [newPath]: focusId! };
      }
      if (s.workspaceViewMode[oldPath]) {
        const { [oldPath]: mode, ...rest } = s.workspaceViewMode;
        result.workspaceViewMode = { ...rest, [newPath]: mode! };
      }
      if (s.runPaneVisible[oldPath] !== undefined) {
        const { [oldPath]: v, ...rest } = s.runPaneVisible;
        result.runPaneVisible = { ...rest, [newPath]: v! };
      }
      if (s.runPaneHeight[oldPath] !== undefined) {
        const { [oldPath]: h, ...rest } = s.runPaneHeight;
        result.runPaneHeight = { ...rest, [newPath]: h! };
      }
      if (s.runPaneTabs[oldPath]) {
        const { [oldPath]: t, ...rest } = s.runPaneTabs;
        result.runPaneTabs = { ...rest, [newPath]: t! };
      }
      if (s.runPaneActiveTabId[oldPath] !== undefined) {
        const { [oldPath]: id, ...rest } = s.runPaneActiveTabId;
        result.runPaneActiveTabId = { ...rest, [newPath]: id! };
      }

      return result;
    }),
  requestNewWorkspace: (repoId) => set({ newWorkspaceRepoId: repoId }),
  pushOverlay: () => set((s) => ({ overlayCount: s.overlayCount + 1 })),
  popOverlay: () => set((s) => ({ overlayCount: Math.max(0, s.overlayCount - 1) })),
}));
