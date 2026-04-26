import { mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  SessionState,
  PaneNodeState,
  OpenPRState,
  WorkspacePaneState,
  FileTreeSessionState,
} from "../shared/ipc-types";
import { PaneTabKind } from "../shared/ipc-types";
import { TEMPEST_DIR } from "./config/paths";

const CURRENT_VERSION = 1;
const RECENT_FILES_LIMIT = 50;

export class SessionStateManager {
  private readonly stateFilePath: string;
  private state: SessionState | null = null;
  private dirty = false;
  private autoSaveTimer?: ReturnType<typeof setInterval>;

  constructor(stateDir?: string) {
    const dir = stateDir ?? TEMPEST_DIR;
    this.stateFilePath = join(dir, "session-state.json");
  }

  async load(): Promise<SessionState | null> {
    if (this.state) return this.state;
    const file = Bun.file(this.stateFilePath);
    if (!(await file.exists())) return null;

    try {
      const state = (await file.json()) as SessionState;
      if (state.version > CURRENT_VERSION) {
        console.log(
          `[SessionStateManager] Unknown state version ${state.version} (current: ${CURRENT_VERSION}). Ignoring saved state.`,
        );
        return null;
      }
      // Remove workspaces whose directories no longer exist on disk
      let cleaned = false;
      for (const wsPath of Object.keys(state.workspaces)) {
        if (!existsSync(wsPath)) {
          console.log(`[SessionStateManager] Removing stale workspace (directory gone): ${wsPath}`);
          delete state.workspaces[wsPath];
          cleaned = true;
        }
      }

      // Migrate legacy `recentFiles` from inside WorkspacePaneState to the
      // top-level map. Older builds nested it; new builds keep it separate so
      // savePaneState can't clobber it. Safe to remove this branch later.
      const recentMap = state.recentFilesByWorkspace ?? {};
      for (const [wsPath, ws] of Object.entries(state.workspaces)) {
        const legacy = (ws as { recentFiles?: string[] }).recentFiles;
        if (legacy && legacy.length > 0 && !recentMap[wsPath]) {
          recentMap[wsPath] = legacy;
          cleaned = true;
        }
        delete (ws as { recentFiles?: string[] }).recentFiles;
      }
      if (Object.keys(recentMap).length > 0) {
        state.recentFilesByWorkspace = recentMap;
      }

      // Clear selected workspace if its directory is gone
      if (state.selectedWorkspacePath && !existsSync(state.selectedWorkspacePath)) {
        console.log(`[SessionStateManager] Clearing stale selected workspace: ${state.selectedWorkspacePath}`);
        state.selectedWorkspacePath = undefined;
        cleaned = true;
      }

      this.state = state;
      if (cleaned) {
        this.dirty = true;
      }
      return state;
    } catch (err) {
      console.log(
        `[SessionStateManager] Failed to load state: ${err}. Renaming corrupt file.`,
      );
      this.renameCorruptFile();
      return null;
    }
  }

  /** Track which workspace the user last had selected. */
  setSelectedWorkspacePath(path: string): void {
    this.ensureState();
    this.state!.selectedWorkspacePath = path;
    this.dirty = true;
  }

  savePaneState(workspacePath: string, paneTree: PaneNodeState): void {
    this.ensureState();
    const existing = this.state!.workspaces[workspacePath];
    this.state!.workspaces[workspacePath] = {
      workspacePath,
      paneTree,
      prState: existing?.prState,
    };
    this.state!.savedAt = new Date().toISOString();
    this.dirty = true;
  }

  savePRState(workspacePath: string, prState: OpenPRState | null): void {
    this.ensureState();
    const existing = this.state!.workspaces[workspacePath];
    if (existing) {
      existing.prState = prState ?? undefined;
    }
    this.dirty = true;
  }

  getPRState(workspacePath: string): OpenPRState | null {
    return this.state?.workspaces[workspacePath]?.prState ?? null;
  }

  recordRecentFile(workspacePath: string, filePath: string): void {
    if (!filePath) return;
    this.ensureState();
    const map = this.state!.recentFilesByWorkspace ?? {};
    const previous = map[workspacePath] ?? [];
    const next = [filePath, ...previous.filter((p) => p !== filePath)].slice(0, RECENT_FILES_LIMIT);
    map[workspacePath] = next;
    this.state!.recentFilesByWorkspace = map;
    this.dirty = true;
  }

  getRecentFiles(workspacePath: string): string[] {
    return this.state?.recentFilesByWorkspace?.[workspacePath] ?? [];
  }

  getPaneState(workspacePath: string): PaneNodeState | null {
    return this.state?.workspaces[workspacePath]?.paneTree ?? null;
  }

  /** Snapshot map of workspacePath -> pane tree for fan-out walks. */
  getAllPaneStates(): Record<string, PaneNodeState> {
    const out: Record<string, PaneNodeState> = {};
    if (!this.state) return out;
    for (const [wsPath, ws] of Object.entries(this.state.workspaces)) {
      if (ws.paneTree) out[wsPath] = ws.paneTree;
    }
    return out;
  }

  isRepoCollapsed(repoId: string): boolean {
    return this.state?.collapsedRepoIds?.includes(repoId) ?? false;
  }

  saveFileTreeState(fileTree: FileTreeSessionState): void {
    this.ensureState();
    this.state!.fileTree = fileTree;
    this.dirty = true;
  }

  getFileTreeState(): FileTreeSessionState | null {
    return this.state?.fileTree ?? null;
  }

  setRepoCollapsed(repoId: string, collapsed: boolean): void {
    this.ensureState();
    const current = new Set(this.state!.collapsedRepoIds ?? []);
    if (collapsed) {
      if (current.has(repoId)) return;
      current.add(repoId);
    } else {
      if (!current.has(repoId)) return;
      current.delete(repoId);
    }
    this.state!.collapsedRepoIds = Array.from(current);
    this.dirty = true;
  }

  /**
   * Walk the persisted pane tree for a workspace and return the first
   * Claude tab's sessionId. Both the uppercase (`sessionID`) and lowercase
   * (`sessionId`) field names are accepted to match PaneTabState.
   */
  getFirstClaudeSessionId(workspacePath: string): string | null {
    const ws = this.state?.workspaces[workspacePath];
    if (!ws) return null;

    const walk = (node: PaneNodeState | undefined): string | null => {
      if (!node) return null;
      if (node.type === "leaf") {
        for (const tab of node.pane.tabs) {
          if (tab.kind !== PaneTabKind.Claude) continue;
          const id = tab.sessionID ?? tab.sessionId;
          if (id) return id;
        }
        return null;
      }
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };

    return walk(ws.paneTree);
  }

  /**
   * Update shellCwd on terminal tabs in all stored pane trees using a
   * terminalId -> cwd map. Scrollback is no longer persisted here; it lives
   * in ScrollbackStore (`scrollback/<terminalId>.json`).
   */
  updateShellCwds(cwds: Map<string, string>): void {
    if (!this.state || cwds.size === 0) return;

    const enrichNode = (node: any): void => {
      if (!node) return;
      if (node.type === "leaf" && node.pane?.tabs) {
        for (const tab of node.pane.tabs) {
          if (!tab.terminalId) continue;
          const cwd = cwds.get(tab.terminalId);
          if (cwd) tab.shellCwd = cwd;
        }
      } else if (node.type === "split" && node.children) {
        for (const child of node.children) enrichNode(child);
      }
    };

    for (const ws of Object.values(this.state.workspaces)) {
      enrichNode(ws.paneTree);
    }
    this.dirty = true;
  }

  /**
   * Walk every pane tree and extract inline scrollbackContent entries as a
   * map keyed by terminalId. Used once at load to migrate pre-split state
   * into ScrollbackStore. Mutates state to strip the inline fields and
   * marks it dirty.
   */
  extractInlineScrollback(): Map<string, { scrollback: string; cwd?: string }> {
    const out = new Map<string, { scrollback: string; cwd?: string }>();
    if (!this.state) return out;

    let found = false;
    const walk = (node: any): void => {
      if (!node) return;
      if (node.type === "leaf" && node.pane?.tabs) {
        for (const tab of node.pane.tabs) {
          if (tab.terminalId && typeof tab.scrollbackContent === "string") {
            out.set(tab.terminalId, {
              scrollback: tab.scrollbackContent,
              cwd: tab.shellCwd,
            });
            delete tab.scrollbackContent;
            found = true;
          }
        }
      } else if (node.type === "split" && node.children) {
        for (const child of node.children) walk(child);
      }
    };

    for (const ws of Object.values(this.state.workspaces)) {
      walk(ws.paneTree);
    }

    if (found) this.dirty = true;
    return out;
  }

  /** Collect all terminalIds currently referenced in any workspace's pane tree. */
  collectLiveTerminalIds(): Set<string> {
    const out = new Set<string>();
    if (!this.state) return out;

    const walk = (node: any): void => {
      if (!node) return;
      if (node.type === "leaf" && node.pane?.tabs) {
        for (const tab of node.pane.tabs) {
          if (tab.terminalId) out.add(tab.terminalId);
        }
      } else if (node.type === "split" && node.children) {
        for (const child of node.children) walk(child);
      }
    };

    for (const ws of Object.values(this.state.workspaces)) {
      walk(ws.paneTree);
    }
    return out;
  }

  migrateWorkspacePath(oldPath: string, newPath: string): void {
    if (!this.state) return;

    const wsState = this.state.workspaces[oldPath];
    if (wsState) {
      delete this.state.workspaces[oldPath];
      wsState.workspacePath = newPath;
      this.state.workspaces[newPath] = wsState;
    }

    if (this.state.selectedWorkspacePath === oldPath) {
      this.state.selectedWorkspacePath = newPath;
    }

    this.dirty = true;
  }

  private ensureState(): void {
    if (!this.state) {
      this.state = {
        version: CURRENT_VERSION,
        savedAt: new Date().toISOString(),
        workspaces: {},
      };
    }
  }

  startAutoSave(intervalMs = 30_000): void {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(() => this.flush(), intervalMs);
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.state) return;

    try {
      const dir = join(this.stateFilePath, "..");
      mkdirSync(dir, { recursive: true });
      await Bun.write(
        this.stateFilePath,
        JSON.stringify(this.state, null, 2),
      );
      this.dirty = false;
    } catch (err) {
      // Keep dirty=true so a later flush can retry persisting state.
      this.dirty = true;
      console.log(`[SessionStateManager] Auto-save failed: ${err}`);
    }
  }

  private renameCorruptFile(): void {
    if (!existsSync(this.stateFilePath)) return;
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-");
    const corruptName = `session-state.${timestamp}.corrupt`;
    const corruptPath = join(this.stateFilePath, "..", corruptName);
    try {
      renameSync(this.stateFilePath, corruptPath);
    } catch {
      // Ignore rename failures
    }
  }
}
