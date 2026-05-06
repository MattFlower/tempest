// ============================================================
// LspServerRegistry — owns one LspServerProcess per (workspace, language).
//
// Lazy: a server doesn't spawn until something asks for it (`getOrSpawn`).
// First-time spawn for a recipe goes through the installer, which may run
// `bun add` to populate ~/.config/tempest/lsp/. Install runs in the
// background — `getOrSpawn` returns the entry synchronously after creating
// it, so document-sync RPCs can register the doc in the entry's
// DocumentStore right away. Once the install + spawn succeed, the
// background flow re-snapshots `entry.docs.all()` and replays didOpen
// with the latest text — edits made while the user was waiting on the
// install are preserved.
//
// Cancellation: every entry carries a `generation` counter; stop and
// restart bump it. The background install/start checks generation after
// every await — when a stop or restart races with an in-flight install,
// the older flow bails before transitioning state, spawning, or
// notifying the server, so we never leak a server process.
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
import { perfTrace } from "../perf-trace";

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
  /**
   * Bumped by stop() and restart() to invalidate any in-flight
   * installAndStart attempt. Background work captures this at start and
   * checks after every await — a mismatch means the entry was reset out
   * from under it and the in-flight work must abort without side effects.
   */
  generation: number;
}

export class LspServerRegistry {
  private servers = new Map<string, ServerEntry>();
  private callbacks: RegistryCallbacks;
  private installer = new Installer();

  constructor(callbacks: RegistryCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get the entry for (workspacePath, languageId), creating it (and
   * kicking off install + start in the background) if necessary. Returns
   * null when no recipe matches the language — caller should treat that
   * as "no LSP available; fall back to Monaco's bundled behaviour".
   *
   * Returns synchronously (the install is fire-and-forget). The returned
   * entry's `status` reflects the moment of return — usually "installing"
   * for first-time entries on npm/github/toolchain recipes, or whatever
   * status an existing entry happens to be in. Callers downstream of
   * getOrSpawn decide what to do based on `entry.status`, not by waiting
   * for "ready".
   */
  getOrSpawn(
    workspacePath: string,
    languageId: string,
  ): ServerEntry | null {
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
      docs: new DocumentStore(),
      status: initialStatus,
      restartCount: 0,
      lastSpawnAt: Date.now(),
      generation: 0,
    };
    this.servers.set(id, entry);
    this.emitState(entry);

    // Fire-and-forget background install + start. Errors inside
    // installAndStart are caught and translated to "error" status; we
    // never let them propagate as unhandled rejections.
    void this.installAndStart(entry);
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

    // Bump generation so any install/start currently in flight bails
    // when it next checks. Then tear down the existing process — we
    // don't want a parallel install bringing up a duplicate behind us.
    entry.generation += 1;
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

    void this.installAndStart(entry);
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
   * Cancellation contract: capture entry.generation at the top, check
   * after every await before any state mutation or external side effect
   * (spawn, notify). On mismatch, abort cleanly — don't transition
   * status, don't emit state, tear down anything we started.
   *
   * Failure paths:
   *   - install error → status "error", lastError = bun stderr
   *   - spawn / initialize error → status "error", lastError = error msg,
   *     proc stopped + cleared
   *   - process crashes after start → handled separately by watchExit in
   *     LspServerProcess, which transitions to "error" via its own callback
   */
  private async installAndStart(entry: ServerEntry): Promise<void> {
    await perfTrace.measure(
      "lsp.installAndStart",
      {
        workspacePath: entry.workspacePath,
        languageId: entry.primaryLanguageId,
        recipe: entry.recipe.name,
      },
      async () => {
        const gen = entry.generation;
        const aborted = () => entry.generation !== gen;

        // --- Install phase ---
        let binaryPath: string;
        try {
          const result = await this.installer.resolve(entry.recipe);
          if (aborted()) return;
          binaryPath = result.binaryPath;
        } catch (err: any) {
          if (aborted()) return;
          entry.status = "error";
          entry.lastError = err?.message ?? String(err);
          this.emitState(entry);
          return;
        }

        // --- Spawn phase ---
        if (aborted()) return;
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
              this.handleStatusChange(entry.id, gen, status, error),
            onDiagnostics: (uri, diags) =>
              this.callbacks.onDiagnostics(uri, diags),
          },
        );
        entry.process = proc;

        try {
          await proc.start();
          if (aborted()) {
            // Stop bumped while we were initializing. Tear down the proc
            // we just started so we don't leak a running server.
            try { await proc.stop("explicit"); } catch { /* ignore */ }
            return;
          }

          // Re-snapshot docs at replay time, not at function entry — the user
          // may have typed during install/restart, and document-store.update
          // rewrote the entries in place with the latest version + text.
          // Replaying the original snapshot would send stale text to the
          // server. Single-threaded JS guarantees no didChange RPC can
          // interleave between status="ready" (set inside proc.start) and
          // the synchronous notify loop below.
          for (const doc of entry.docs.all()) {
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
          if (aborted()) {
            try { await proc.stop("explicit"); } catch { /* ignore */ }
            return;
          }
          // proc.start() rejected — most often the server returned an error
          // for `initialize` while staying alive (config rejected, missing
          // dependency, etc). The watchExit handler inside LspServerProcess
          // wouldn't fire in that case, so without this branch the entry
          // would stay stuck on "starting" forever.
          entry.status = "error";
          entry.lastError = err?.message ?? String(err);
          try { await proc.stop("explicit"); } catch { /* ignore */ }
          entry.process = null;
          this.emitState(entry);
        }
      },
    );
  }

  private async stopEntry(entry: ServerEntry): Promise<void> {
    // Bump generation so any in-flight installAndStart bails when it
    // next checks — without this, a server downloaded mid-stop could
    // come up after we deleted its entry.
    entry.generation += 1;

    if (entry.process) {
      try { await entry.process.stop("explicit"); } catch { /* ignore */ }
    }

    // Clear any diagnostics this server published — without this, Monaco
    // markers stay on the editor after the server stops, and the user
    // sees stale red squiggles for a server that no longer exists. We
    // reuse the existing onDiagnostics push channel: an empty array tells
    // the webview's applyDiagnostics to clear that URI's markers.
    for (const doc of entry.docs.all()) {
      this.callbacks.onDiagnostics(doc.uri, []);
    }

    this.servers.delete(entry.id);
    // Final state push so the UI sees the entry disappear cleanly.
    entry.status = "stopped";
    this.emitState(entry);
  }

  /**
   * Forwarder from LspServerProcess's onStatusChange to the registry's
   * emitState. Drops events from a stale generation: a process that's
   * been logically replaced by a restart can still fire status events
   * (e.g. the watchExit watcher firing on the old proc), and those must
   * not overwrite the new generation's state.
   */
  private handleStatusChange(
    id: string,
    gen: number,
    status: LspServerStatus,
    error?: string,
  ): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    if (entry.generation !== gen) return;
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
