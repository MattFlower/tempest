// ============================================================
// LspServerRegistry — owns one LspServerProcess per (workspace, language).
//
// Lazy: a server doesn't spawn until something asks for it (`getOrSpawn`).
// Single-shot restart on crash: the next request triggers a fresh spawn
// and replays didOpen for every doc the bridge had registered. After a
// failed restart we back off — the entry stays in "error" status until
// the user explicitly retries via the footer popover.
//
// Disable handling: callers must not call getOrSpawn when the workspace's
// repo (or the global config) has LSP off. The check lives one layer up
// in lsp-rpc.ts so the registry stays focused on process lifecycle.
// ============================================================

import { basename } from "node:path";
import { LspServerProcess } from "./server-process";
import { DocumentStore } from "./document-store";
import { recipeForLanguage, type ServerRecipe } from "./recipes";
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
  process: LspServerProcess;
  docs: DocumentStore;
  status: LspServerStatus;
  lastError?: string;
  restartCount: number;
  lastSpawnAt: number;
}

export class LspServerRegistry {
  private servers = new Map<string, ServerEntry>();
  private callbacks: RegistryCallbacks;

  constructor(callbacks: RegistryCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get the entry for (workspacePath, languageId), spawning if necessary.
   * Returns null when no recipe matches the language — caller should treat
   * that as "no LSP available; fall back to Monaco's bundled behaviour".
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
      // If a previous attempt failed, allow one explicit-retry hook; the
      // registry itself doesn't auto-retry on every getOrSpawn because
      // hammering a broken binary would generate noise and dropped
      // requests during typing. The footer popover's restart button is
      // the user-facing retry path.
      if (existing.status === "error" && existing.process.getStatus() === "error") {
        return existing;
      }
      return existing;
    }

    const docs = new DocumentStore();
    const proc = new LspServerProcess(
      {
        name: recipe.name,
        command: recipe.command,
        rootUri: `file://${workspacePath}`,
        workspaceFolderName: basename(workspacePath),
        languageId,
      },
      {
        onStatusChange: (status, error) => this.handleStatusChange(id, status, error),
        onDiagnostics: (uri, diags) => this.callbacks.onDiagnostics(uri, diags),
      },
    );

    const entry: ServerEntry = {
      id,
      workspacePath,
      primaryLanguageId: languageId,
      recipe,
      process: proc,
      docs,
      status: "starting",
      restartCount: 0,
      lastSpawnAt: Date.now(),
    };
    this.servers.set(id, entry);
    this.emitState(entry);

    try {
      await proc.start();
    } catch (err: any) {
      // start() already transitioned status to "error" via the callback.
      entry.lastError = err?.message ?? String(err);
    }

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
   * Restart a server, replaying didOpen for all docs it had open. Triggered
   * from the footer popover's restart button.
   */
  async restart(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;

    const docs = entry.docs.all();
    await entry.process.stop("explicit");

    // Reuse the same DocumentStore so the bridge's open-doc tracking and
    // the registry's tracking can't drift across the restart boundary.
    const newProc = new LspServerProcess(
      {
        name: entry.recipe.name,
        command: entry.recipe.command,
        rootUri: `file://${entry.workspacePath}`,
        workspaceFolderName: basename(entry.workspacePath),
        languageId: entry.primaryLanguageId,
      },
      {
        onStatusChange: (status, error) => this.handleStatusChange(id, status, error),
        onDiagnostics: (uri, diags) => this.callbacks.onDiagnostics(uri, diags),
      },
    );

    entry.process = newProc;
    entry.restartCount += 1;
    entry.lastError = undefined;
    entry.status = "starting";
    entry.lastSpawnAt = Date.now();
    this.emitState(entry);

    try {
      await newProc.start();
      // Replay all open docs so the server can resume serving them.
      for (const doc of docs) {
        newProc.notify("textDocument/didOpen", {
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

  /** Pids currently running — for the memory sampler. */
  liveProcessIds(): Array<{ serverId: string; pid: number }> {
    const out: Array<{ serverId: string; pid: number }> = [];
    for (const e of this.servers.values()) {
      const pid = e.process.getPid();
      if (pid) out.push({ serverId: e.id, pid });
    }
    return out;
  }

  // --- Internal ---

  private async stopEntry(entry: ServerEntry): Promise<void> {
    try { await entry.process.stop("explicit"); } catch { /* ignore */ }
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
      pid: entry.process.getPid(),
      lastError: entry.lastError,
      restartCount: entry.restartCount,
    };
  }
}

function entryKey(workspacePath: string, recipe: ServerRecipe): string {
  return `${workspacePath}::${recipe.name}`;
}

export type { ServerEntry };
