// ============================================================
// LSP RPC handlers — the surface the webview calls.
//
// This module is purely glue: it owns the LspServerRegistry + MemorySampler
// instances, exposes request handlers that the Bun rpc registration in
// index.ts plugs into, and exposes push hooks that index.ts wires to
// `win.webview.rpc.send.*`.
//
// Disable handling lives here so the registry stays single-purpose. We
// look up the workspace's repo via the WorkspaceManager and gate every
// spawn-capable call (`lspDidOpen`, hover, definition) on:
//   - global config.lspDisabled
//   - per-repo settings.disableLsp for the workspace's repo
// ============================================================

import type {
  LspDiagnostic,
  LspHoverResult,
  LspLocation,
  LspMemorySample,
  LspServerState,
  RepoSettings,
} from "../../shared/ipc-types";
import { LspServerRegistry } from "./server-registry";
import { MemorySampler } from "./memory-sampler";
import type { WorkspaceManager } from "../workspace-manager";
import type { AppConfig } from "../../shared/ipc-types";

export interface LspRpcDeps {
  workspaceManager: WorkspaceManager;
  /** Read the current AppConfig. The lspDisabled flag is consulted on every gate check. */
  getConfig: () => AppConfig;
  /** Push channels — wired to win.webview.rpc.send.* in index.ts. */
  pushDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
  pushServerState: (state: LspServerState) => void;
  pushMemorySamples: (samples: LspMemorySample[]) => void;
}

export class LspRpc {
  private registry: LspServerRegistry;
  private memorySampler: MemorySampler;
  private memoryUnsub: (() => void) | null = null;

  constructor(private readonly deps: LspRpcDeps) {
    this.registry = new LspServerRegistry({
      onStateChange: (state) => this.deps.pushServerState(state),
      onDiagnostics: (uri, diags) => this.deps.pushDiagnostics(uri, diags),
    });
    this.memorySampler = new MemorySampler(this.registry);
  }

  /**
   * Decide whether LSP is allowed for this workspace right now. The
   * answer can flip at runtime when the user toggles either the global
   * setting or the repo's disableLsp — gating every spawn-capable call
   * keeps the source of truth in one place.
   */
  private isAllowed(workspacePath: string): boolean {
    if (this.deps.getConfig().lspDisabled) return false;
    const ws = this.deps.workspaceManager.findWorkspaceByPath(workspacePath);
    if (!ws) return true; // free-standing file (not under a managed repo) — allow
    const settings: RepoSettings | undefined = ws.repoPath
      ? this.deps.workspaceManager.getRepoSettings(ws.repoPath)
      : undefined;
    return !(settings?.disableLsp);
  }

  /** Called when the user toggles config.lspDisabled to true at runtime. */
  async tearDownAll(): Promise<void> {
    await this.registry.stopAll();
  }

  /** Called when the user enables disableLsp for a repo at runtime. */
  async tearDownForRepo(repoPath: string): Promise<void> {
    const wsList = this.deps.workspaceManager.getAllWorkspaces();
    for (const ws of wsList) {
      if (ws.repoPath === repoPath) {
        await this.registry.stopWorkspace(ws.path);
      }
    }
  }

  // --- Request handlers (called from index.ts rpc registration) ---

  listServers(): { servers: LspServerState[] } {
    return { servers: this.registry.listStates() };
  }

  async restartServer(serverId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.registry.restart(serverId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  async stopServer(serverId: string): Promise<{ ok: boolean }> {
    const entry = this.registry.get(serverId);
    if (!entry) return { ok: true };
    await this.registry.stopWorkspace(entry.workspacePath);
    return { ok: true };
  }

  getServerLog(serverId: string): { lines: string[] } {
    const entry = this.registry.get(serverId);
    if (!entry) return { lines: [] };
    return { lines: entry.process.getLogLines() };
  }

  async memoryWatchStart(): Promise<{ samples: LspMemorySample[] }> {
    if (this.memoryUnsub) this.memoryUnsub(); // avoid double-subscribing
    this.memoryUnsub = this.memorySampler.subscribe((samples) => {
      this.deps.pushMemorySamples(samples);
    });
    // Seed the caller with a synchronous snapshot so the popover doesn't
    // flash empty rows for up to one sample interval after opening.
    return { samples: await this.memorySampler.sampleOnce() };
  }

  memoryWatchStop(): void {
    if (this.memoryUnsub) {
      this.memoryUnsub();
      this.memoryUnsub = null;
    }
  }

  async didOpen(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }): Promise<void> {
    if (!this.isAllowed(params.workspacePath)) return;
    const entry = await this.registry.getOrSpawn(params.workspacePath, params.languageId);
    console.log("[lsp-rpc] didOpen", {
      uri: params.uri,
      languageId: params.languageId,
      hasEntry: !!entry,
      status: entry?.process.getStatus(),
    });
    if (!entry || entry.process.getStatus() !== "ready") {
      // Server failed to start or is still initializing — DocumentStore
      // still tracks the doc so a successful restart can replay it.
      entry?.docs.open(params.uri, params.languageId, params.version, params.text);
      return;
    }
    entry.docs.open(params.uri, params.languageId, params.version, params.text);
    entry.process.notify("textDocument/didOpen", {
      textDocument: {
        uri: params.uri,
        languageId: params.languageId,
        version: params.version,
        text: params.text,
      },
    });
  }

  async didChange(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }): Promise<void> {
    if (!this.isAllowed(params.workspacePath)) return;
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry) return;
    entry.docs.update(params.uri, params.version, params.text);
    if (entry.process.getStatus() !== "ready") return;
    // Full-text sync. Servers that advertise incremental sync still accept
    // full-text didChange; we'll switch to incremental in phase 3 if perf
    // shows up as a problem.
    entry.process.notify("textDocument/didChange", {
      textDocument: { uri: params.uri, version: params.version },
      contentChanges: [{ text: params.text }],
    });
  }

  didClose(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
  }): void {
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry) return;
    entry.docs.close(params.uri);
    if (entry.process.getStatus() === "ready") {
      entry.process.notify("textDocument/didClose", {
        textDocument: { uri: params.uri },
      });
    }
  }

  async hover(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }): Promise<{ result: LspHoverResult | null }> {
    if (!this.isAllowed(params.workspacePath)) return { result: null };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    console.log("[lsp-rpc] hover", {
      uri: params.uri,
      hasEntry: !!entry,
      status: entry?.process.getStatus(),
    });
    if (!entry || entry.process.getStatus() !== "ready") return { result: null };

    try {
      const raw = (await entry.process.request("textDocument/hover", {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })) as
        | { contents?: unknown; range?: { start: any; end: any } }
        | null;
      if (!raw) return { result: null };
      return { result: { contents: hoverContentsToMarkdown(raw.contents), range: raw.range } };
    } catch {
      return { result: null };
    }
  }

  async definition(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }): Promise<{ locations: LspLocation[] }> {
    if (!this.isAllowed(params.workspacePath)) return { locations: [] };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.process.getStatus() !== "ready") return { locations: [] };

    try {
      const raw = (await entry.process.request("textDocument/definition", {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })) as LspLocation | LspLocation[] | null;
      if (!raw) return { locations: [] };
      return { locations: Array.isArray(raw) ? raw : [raw] };
    } catch {
      return { locations: [] };
    }
  }
}

/**
 * LSP hover.contents has three valid shapes (legacy unfortunately):
 *   - `string`
 *   - `MarkedString | MarkedString[]` where MarkedString = string | { language, value }
 *   - `MarkupContent { kind, value }`
 * Normalize to a list of markdown blocks for the webview, which renders
 * each block back-to-back in Monaco's hover widget.
 */
function hoverContentsToMarkdown(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.flatMap(hoverContentsToMarkdown);
  if (typeof raw === "object") {
    const r = raw as { kind?: string; value?: string; language?: string };
    if (typeof r.value === "string") {
      // MarkedString with language: wrap in a fenced code block so it
      // renders as code in Monaco's hover.
      if (r.language) return ["```" + r.language + "\n" + r.value + "\n```"];
      return [r.value];
    }
  }
  return [];
}
