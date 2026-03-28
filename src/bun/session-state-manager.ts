import { mkdirSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SessionState,
  PaneNodeState,
  WorkspacePaneState,
} from "../shared/ipc-types";

const CURRENT_VERSION = 1;

export class SessionStateManager {
  private readonly stateFilePath: string;
  private state: SessionState | null = null;
  private dirty = false;
  private autoSaveTimer?: ReturnType<typeof setInterval>;

  constructor(stateDir?: string) {
    const dir = stateDir ?? join(homedir(), ".local", "share", "Tempest");
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
      this.state = state;
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
    this.state!.workspaces[workspacePath] = { workspacePath, paneTree };
    this.state!.savedAt = new Date().toISOString();
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
