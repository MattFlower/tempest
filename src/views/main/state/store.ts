// ============================================================
// Zustand store — central UI state for the webview process.
// Persistent state (workspaces, config) lives in the Bun process
// and is synced via RPC. UI-only state (focused pane, maximize,
// palette visibility) lives here.
// ============================================================

import { create } from "zustand";
import type { SourceRepo, TempestWorkspace, WorkspaceSidebarInfo, AppConfig } from "../models/workspace";
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

  // --- UI state ---
  sidebarWidth: number;
  sidebarVisible: boolean;
  commandPaletteVisible: boolean;

  // --- Actions (set by action creators) ---
  setRepos: (repos: SourceRepo[]) => void;
  setWorkspaces: (repoId: string, workspaces: TempestWorkspace[]) => void;
  selectWorkspace: (path: string | null) => void;
  setSidebarInfo: (path: string, info: WorkspaceSidebarInfo) => void;
  setConfig: (config: AppConfig) => void;

  setPaneTree: (workspacePath: string, tree: PaneNode) => void;
  setFocusedPaneId: (id: string | null) => void;
  setMaximizedPaneId: (id: string | null) => void;

  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  toggleCommandPalette: () => void;
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

  sidebarWidth: 240,
  sidebarVisible: true,
  commandPaletteVisible: false,

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

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteVisible: !s.commandPaletteVisible })),
}));
