import { mkdirSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SessionState,
  PaneNodeState,
  OpenPRState,
  WorkspacePaneState,
} from "../shared/ipc-types";

const CURRENT_VERSION = 1;

export class SessionStateManager {
  private readonly stateFilePath: string;
  private state: SessionState | null = null;
  private dirty = false;
  private autoSaveTimer?: ReturnType<typeof setInterval>;

  constructor(stateDir?: string) {
    const dir = stateDir ?? join(homedir(), "Library", "Application Support", "Tempest");
    this.stateFilePath = join(dir, "session-state.json");
  }

  async load(): Promise<SessionState | null> {
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

  /** Update scrollback/cwd on terminal tabs in all stored pane trees. */
  enrichTerminalData(
    cache: Map<string, { scrollback: string; cwd?: string }>,
  ): void {
    if (!this.state || cache.size === 0) return;

    const enrichNode = (node: any): void => {
      if (!node) return;
      if (node.type === "leaf" && node.pane?.tabs) {
        for (const tab of node.pane.tabs) {
          if (!tab.terminalId) continue;
          const cached = cache.get(tab.terminalId);
          if (cached) {
            tab.scrollbackContent = cached.scrollback;
            if (cached.cwd) tab.shellCwd = cached.cwd;
          }
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
    this.dirty = false;

    try {
      const dir = join(this.stateFilePath, "..");
      mkdirSync(dir, { recursive: true });
      await Bun.write(
        this.stateFilePath,
        JSON.stringify(this.state, null, 2),
      );
    } catch (err) {
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
