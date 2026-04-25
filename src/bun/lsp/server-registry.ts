// ============================================================
// LspServerRegistry — owns one LspServerProcess per (workspace, language).
//
// Lazy: a server doesn't spawn until something asks for it (`getOrSpawn`).
// First-time spawn for a recipe goes through the installer, which may run
// `bun add` to populate ~/.config/tempest/lsp/. While that's in flight the
// entry exists in the registry with status "installing" and a null process,
// so the footer can render "installing typescript-language-server…" without
// holding the LSP request.
//
// Single-shot restart on crash: the next request triggers a fresh spawn
// and replays didOpen for every doc the bridge had registered. After a
// failed install or restart we back off — the entry stays in "error"
// status until the user explicitly retries via the footer popover.
//
// Disable handling: callers must not call getOrSpawn when the workspace's
// repo (or the global config) has LSP off. The check lives one layer up
// in lsp-rpc.ts so the registry stays focused on process lifecycle.
// ============================================================

import { basename } from "node:path";
import { LspServerProcess } from "./server-process";
import { DocumentStore } from "./document-store";
import { recipeForLanguage, type ServerRecipe } from "./recipes";
import { Installer } from "./installer/installer";
import type {
  LspDiagnostic,
  LspServerState,
  LspServerStatus,
} from "../../shared/ipc-types";

export interface RegistryCallbacks {
  onStateChange: (state: LspServerState) => void;
  onDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
}

interface ServerEntry {
  id: string;                       // `${workspacePath}::${recipeKey}`
  workspacePath: string;
  /** The first languageId that requested this server — used for display. */
  primaryLanguageId: string;
  recipe: ServerRecipe;
  /** Null while the installer is resolving the binary; set after spawn. */
  process: LspServerProcess | null;
  docs: DocumentStore;
  status: LspServerStatus;
  lastError?: string;
  restartCount: number;
  lastSpawnAt: number;
}

export class LspServerRegistry {
  private servers = new Map<string, ServerEntry>();
  private callbacks: RegistryCallbacks;
  private installer = new Installer();

  constructor(callbacks: RegistryCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get the entry for (workspacePath, languageId), spawning if necessary.
   * Returns null when no recipe matches the language — caller should treat
   * that as "no LSP available; fall back to Monaco's bundled behaviour".
   *
   * The returned entry may be in any state — caller should consult
   * `entry.status` rather than poking the process directly. In particular,
   * an entry can come back in "installing" status (install in flight) or
   * "error" (install or initialize failed); callers downstream of getOrSpawn
   * decide what to do based on status, not by waiting for "ready".
   */
  async getOrSpawn(
    workspacePath: string,
    languageId: string,
  ): Promise<ServerEntry | null> {
    const recipe = recipeForLanguage(languageId);
    if (!recipe) return null;

    const id = entryKey(workspacePath, recipe);
    const existing = this.servers.get(id);
    if (existing) {
      // Don't auto-retry on every getOrSpawn — hammering a broken binary
      // would generate noise during typing. The footer popover's restart
      // button is the user-facing retry path for both error states
      // ("install failed" and "process crashed").
      return existing;
    }

    // Create the entry up front in "installing" state so the footer can
    // show progress while the (potentially slow) `bun add` runs.
    const docs = new DocumentStore();
    // System-bucket recipes resolve via PATH lookup with no real "install"
    // step, so they jump straight to "starting". Everything else may need
    // a download/build/extract — show "installing" so the footer note is
    // honest while that's in flight.
    const initialStatus: LspServerStatus =
      recipe.installer.kind === "system" ? "starting" : "installing";
    const entry: ServerEntry = {
      id,
      workspacePath,
      primaryLanguageId: languageId,
      recipe,
      process: null,
      docs,
      status: initialStatus,
      restartCount: 0,
      lastSpawnAt: Date.now(),
    };
    this.servers.set(id, entry);
    this.emitState(entry);

    await this.installAndStart(entry);
    return entry;
  }

  /** Look up a server by its composite id (used by RPC handlers from the webview). */
  get(id: string): ServerEntry | undefined {
    return this.servers.get(id);
  }

  /** Snapshot of every server's public state — used by the footer popover. */
  listStates(): LspServerState[] {
    return Array.from(this.servers.values()).map((e) => this.toState(e));
  }

  /**
   * Resolve a (workspacePath, languageId) to its current entry. Used by the
   * document-sync RPC handlers — they don't want to lazily spawn from a
   * didChange/didClose, only from didOpen.
   */
  find(workspacePath: string, languageId: string): ServerEntry | undefined {
    const recipe = recipeForLanguage(languageId);
    if (!recipe) return undefined;
    return this.servers.get(entryKey(workspacePath, recipe));
  }

  /** Kill one specific server (the popover's stop button uses this). */
  async stop(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;
    await this.stopEntry(entry);
  }

  /** Kill all servers for a workspace (called when the workspace closes). */
  async stopWorkspace(workspacePath: string): Promise<void> {
    const targets = Array.from(this.servers.values()).filter(
      (e) => e.workspacePath === workspacePath,
    );
    await Promise.all(targets.map((e) => this.stopEntry(e)));
  }

  /** Kill every server. Used when the user toggles LSP off globally. */
  async stopAll(): Promise<void> {
    const targets = Array.from(this.servers.values());
    await Promise.all(targets.map((e) => this.stopEntry(e)));
  }

  /**
   * Restart a server. Re-runs the installer (which is fast on the manifest
   * hit and retries install on a manifest miss), then re-spawns and replays
   * didOpen for every previously-open doc. Triggered from the footer
   * popover's restart button.
   */
  async restart(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;

    if (entry.process) {
      try { await entry.process.stop("explicit"); } catch { /* ignore */ }
    }
    entry.process = null;
    entry.restartCount += 1;
    entry.lastError = undefined;
    entry.status =
      entry.recipe.installer.kind === "system" ? "starting" : "installing";
    entry.lastSpawnAt = Date.now();
    this.emitState(entry);

    await this.installAndStart(entry);
  }

  /** Pids currently running — for the memory sampler. */
  liveProcessIds(): Array<{ serverId: string; pid: number }> {
    const out: Array<{ serverId: string; pid: number }> = [];
    for (const e of this.servers.values()) {
      const pid = e.process?.getPid();
      if (pid) out.push({ serverId: e.id, pid });
    }
    return out;
  }

  // --- Internal ---

  /**
   * Run install (if needed) → spawn → handshake → replay didOpen. Used by
   * both initial spawn (getOrSpawn) and restart (popover button), so the
   * fail/retry behaviour is consistent.
   *
   * On install failure: entry transitions to "error" with the bun stderr;
   * we return without throwing so getOrSpawn can yield the entry back to
   * the caller in error state.
   *
   * On spawn failure (binary exists but the process crashed during init):
   * `LspServerProcess.start()` flips the status to "error" via its own
   * status callback; we just record `lastError` and bail.
   */
  private async installAndStart(entry: ServerEntry): Promise<void> {
    const docsToReplay = entry.docs.all();

    let binaryPath: string;
    try {
      const result = await this.installer.resolve(entry.recipe);
      binaryPath = result.binaryPath;
    } catch (err: any) {
      entry.status = "error";
      entry.lastError = err?.message ?? String(err);
      this.emitState(entry);
      return;
    }

    // Install done — transition to "starting" before spawning so the UI
    // reflects the lifecycle phases distinctly.
    entry.status = "starting";
    this.emitState(entry);

    const proc = new LspServerProcess(
      {
        name: entry.recipe.name,
        command: [binaryPath, ...entry.recipe.args],
        rootUri: `file://${entry.workspacePath}`,
        workspaceFolderName: basename(entry.workspacePath),
        languageId: entry.primaryLanguageId,
      },
      {
        onStatusChange: (status, error) =>
          this.handleStatusChange(entry.id, status, error),
        onDiagnostics: (uri, diags) =>
          this.callbacks.onDiagnostics(uri, diags),
      },
    );
    entry.process = proc;

    try {
      await proc.start();
      // Replay didOpen for everything the registry already knew about.
      // Initial spawn: this list is empty (DocumentStore is fresh).
      // Restart: this list has every doc the bridge had registered.
      for (const doc of docsToReplay) {
        proc.notify("textDocument/didOpen", {
          textDocument: {
            uri: doc.uri,
            languageId: doc.languageId,
            version: doc.version,
            text: doc.text,
          },
        });
      }
    } catch (err: any) {
      entry.lastError = err?.message ?? String(err);
    }
  }

  private async stopEntry(entry: ServerEntry): Promise<void> {
    if (entry.process) {
      try { await entry.process.stop("explicit"); } catch { /* ignore */ }
    }
    this.servers.delete(entry.id);
    // Final state push so the UI sees the entry disappear cleanly.
    entry.status = "stopped";
    this.emitState(entry);
  }

  private handleStatusChange(
    id: string,
    status: LspServerStatus,
    error?: string,
  ): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    entry.status = status;
    if (error) entry.lastError = error;
    if (status === "ready") entry.lastError = undefined;
    this.emitState(entry);
  }

  private emitState(entry: ServerEntry): void {
    this.callbacks.onStateChange(this.toState(entry));
  }

  private toState(entry: ServerEntry): LspServerState {
    return {
      id: entry.id,
      workspacePath: entry.workspacePath,
      languageId: entry.primaryLanguageId,
      serverName: entry.recipe.name,
      status: entry.status,
      ...(entry.process?.getPid() !== undefined ? { pid: entry.process!.getPid()! } : {}),
      ...(entry.lastError !== undefined ? { lastError: entry.lastError } : {}),
      restartCount: entry.restartCount,
    };
  }
}

function entryKey(workspacePath: string, recipe: ServerRecipe): string {
  return `${workspacePath}::${recipe.name}`;
}

export type { ServerEntry };
