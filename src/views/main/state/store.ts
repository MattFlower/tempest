// ============================================================
// Zustand store — central UI state for the webview process.
// Persistent state (workspaces, config) lives in the Bun process
// and is synced via RPC. UI-only state (focused pane, maximize,
// palette visibility) lives here.
// ============================================================

import { create } from "zustand";
import type { SourceRepo, TempestWorkspace, WorkspaceSidebarInfo, AppConfig } from "../models/workspace";
import { type ActivityState, ViewMode } from "../../../shared/ipc-types";
import type { PaneNode } from "../models/pane-node";

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
  maximizedPaneId: string | null;

  // --- View mode (per workspace) ---
  workspaceViewMode: Record<string, ViewMode>; // keyed by workspace path

  // --- Activity state (from hook events) ---
  workspaceActivity: Record<string, ActivityState>; // keyed by workspace path

  // --- Drag state ---
  isTabDragActive: boolean;
  setTabDragActive: (active: boolean) => void;

  // --- UI state ---
  sidebarWidth: number;
  sidebarVisible: boolean;
  commandPaletteVisible: boolean;
  commandPaletteInitialMode: "commands" | "files";
  settingsDialogVisible: boolean;
  settingsDialogInitialTab: "general" | "remote";
  httpServerRunning: boolean;
  httpServerError: string | null;
  newWorkspaceRepoId: string | null;
  overlayCount: number;

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

  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  toggleCommandPalette: () => void;
  openCommandPaletteFiles: () => void;
  toggleSettingsDialog: () => void;
  openSettingsTab: (tab: "general" | "remote") => void;
  setHttpServerStatus: (running: boolean, error?: string | null) => void;
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
  maximizedPaneId: null,

  workspaceViewMode: {},

  workspaceActivity: {},

  isTabDragActive: false,
  setTabDragActive: (active) => set({ isTabDragActive: active }),

  sidebarWidth: 240,
  sidebarVisible: true,
  commandPaletteVisible: false,
  commandPaletteInitialMode: "commands" as const,
  settingsDialogVisible: false,
  settingsDialogInitialTab: "general" as const,
  httpServerRunning: false,
  httpServerError: null,
  newWorkspaceRepoId: null,
  overlayCount: 0,

  // Actions
  setRepos: (repos) => set({ repos }),
  setWorkspaces: (repoId, workspaces) =>
    set((s) => ({
      workspacesByRepo: { ...s.workspacesByRepo, [repoId]: workspaces },
    })),
  selectWorkspace: (path) =>
    set({ selectedWorkspacePath: path, maximizedPaneId: null }),
  setSidebarInfo: (path, info) =>
    set((s) => ({ sidebarInfo: { ...s.sidebarInfo, [path]: info } })),
  setConfig: (config) => set({ config }),

  setPaneTree: (workspacePath, tree) =>
    set((s) => ({ paneTrees: { ...s.paneTrees, [workspacePath]: tree } })),
  setFocusedPaneId: (id) => set({ focusedPaneId: id }),
  setMaximizedPaneId: (id) => set({ maximizedPaneId: id }),

  setViewMode: (workspacePath, mode) =>
    set((s) => ({ workspaceViewMode: { ...s.workspaceViewMode, [workspacePath]: mode } })),

  setWorkspaceActivity: (path, state) =>
    set((s) => ({ workspaceActivity: { ...s.workspaceActivity, [path]: state } })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleCommandPalette: () =>
    set((s) => ({
      commandPaletteVisible: !s.commandPaletteVisible,
      commandPaletteInitialMode: "commands" as const,
    })),
  openCommandPaletteFiles: () =>
    set({ commandPaletteVisible: true, commandPaletteInitialMode: "files" as const }),
  toggleSettingsDialog: () =>
    set((s) => ({
      settingsDialogVisible: !s.settingsDialogVisible,
      settingsDialogInitialTab: s.settingsDialogVisible ? s.settingsDialogInitialTab : "general" as const,
    })),
  openSettingsTab: (tab) =>
    set({ settingsDialogVisible: true, settingsDialogInitialTab: tab }),
  setHttpServerStatus: (running, error) =>
    set({ httpServerRunning: running, httpServerError: error ?? null }),
  requestNewWorkspace: (repoId) => set({ newWorkspaceRepoId: repoId }),
  pushOverlay: () => set((s) => ({ overlayCount: s.overlayCount + 1 })),
  popOverlay: () => set((s) => ({ overlayCount: Math.max(0, s.overlayCount - 1) })),
}));
