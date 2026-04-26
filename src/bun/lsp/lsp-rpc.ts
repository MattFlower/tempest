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
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspMemorySample,
  LspPrepareRenameResult,
  LspRange,
  LspServerState,
  LspWorkspaceEdit,
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
    await this.registry.stop(serverId);
    return { ok: true };
  }

  getServerLog(serverId: string): { lines: string[] } {
    const entry = this.registry.get(serverId);
    if (!entry) return { lines: [] };
    // process is null while the installer is running. Surface the lastError
    // (which holds bun stderr on install failure) so the popover's "view log"
    // button is still useful before any process exists.
    if (!entry.process) {
      return { lines: entry.lastError ? [entry.lastError] : [] };
    }
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

  didOpen(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }): void {
    if (!this.isAllowed(params.workspacePath)) return;
    const entry = this.registry.getOrSpawn(params.workspacePath, params.languageId);
    if (!entry) return;

    // Always register the doc immediately, regardless of install/start
    // state. The registry's installAndStart re-snapshots entry.docs at
    // replay time, so any didChange the bridge sends while the server
    // is still installing flows through entry.docs.update and reaches
    // the server with the latest text once it's ready. Without this,
    // didChange would no-op (no doc to update) and edits would be lost.
    entry.docs.open(params.uri, params.languageId, params.version, params.text);

    if (entry.status === "ready" && entry.process) {
      entry.process.notify("textDocument/didOpen", {
        textDocument: {
          uri: params.uri,
          languageId: params.languageId,
          version: params.version,
          text: params.text,
        },
      });
    }
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
    if (entry.status !== "ready" || !entry.process) return;
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
    if (entry.status === "ready" && entry.process) {
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
    if (!entry || entry.status !== "ready" || !entry.process) return { result: null };

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
    if (!entry || entry.status !== "ready" || !entry.process) return { locations: [] };

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

  async completion(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    triggerCharacter?: string;
  }): Promise<{ result: LspCompletionList | null }> {
    if (!this.isAllowed(params.workspacePath)) return { result: null };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.status !== "ready" || !entry.process) return { result: null };

    try {
      // textDocument/completion accepts an optional CompletionContext that
      // tells the server how the request was triggered (manual vs from a
      // trigger character). Some servers (e.g. tsserver via
      // typescript-language-server) tune their result list based on this.
      const reqParams: Record<string, unknown> = {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      };
      if (params.triggerCharacter) {
        reqParams.context = {
          triggerKind: 2, // TriggerCharacter
          triggerCharacter: params.triggerCharacter,
        };
      } else {
        reqParams.context = { triggerKind: 1 }; // Invoked
      }

      const raw = (await entry.process.request("textDocument/completion", reqParams)) as
        | { isIncomplete?: boolean; items?: unknown[] }
        | unknown[]
        | null;

      if (!raw) return { result: null };

      // Server may return either a CompletionList (object with items) or
      // a bare array of CompletionItems — normalize.
      const isList = !Array.isArray(raw) && typeof raw === "object" && "items" in raw;
      const items = (isList ? (raw as { items: unknown[] }).items : (raw as unknown[])) ?? [];
      const isIncomplete =
        isList && (raw as { isIncomplete?: boolean }).isIncomplete === true;

      return {
        result: {
          isIncomplete,
          items: items.map(normalizeCompletionItem).filter((x): x is LspCompletionItem => !!x),
        },
      };
    } catch {
      return { result: null };
    }
  }

  async references(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
  }): Promise<{ locations: LspLocation[] }> {
    if (!this.isAllowed(params.workspacePath)) return { locations: [] };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.status !== "ready" || !entry.process) return { locations: [] };

    try {
      const raw = (await entry.process.request("textDocument/references", {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        context: { includeDeclaration: params.includeDeclaration },
      })) as LspLocation[] | null;
      return { locations: Array.isArray(raw) ? raw : [] };
    } catch {
      return { locations: [] };
    }
  }

  async documentSymbols(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
  }): Promise<{ symbols: LspDocumentSymbol[] }> {
    if (!this.isAllowed(params.workspacePath)) return { symbols: [] };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.status !== "ready" || !entry.process) return { symbols: [] };

    try {
      const raw = (await entry.process.request("textDocument/documentSymbol", {
        textDocument: { uri: params.uri },
      })) as unknown[] | null;
      if (!Array.isArray(raw)) return { symbols: [] };
      return { symbols: raw.map(normalizeSymbol).filter((x): x is LspDocumentSymbol => !!x) };
    } catch {
      return { symbols: [] };
    }
  }

  async prepareRename(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
  }): Promise<{ result: LspPrepareRenameResult | null }> {
    if (!this.isAllowed(params.workspacePath)) return { result: null };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.status !== "ready" || !entry.process) return { result: null };

    try {
      const raw = (await entry.process.request("textDocument/prepareRename", {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })) as
        | LspRange
        | { range: LspRange; placeholder?: string }
        | { defaultBehavior: boolean }
        | null;

      if (!raw) return { result: null };
      // Three result shapes per spec:
      //   - Range: rename allowed, use this range
      //   - { range, placeholder }: same plus suggested initial text
      //   - { defaultBehavior: true }: server doesn't have a custom range,
      //     editor should use the word at cursor
      if ("defaultBehavior" in raw) {
        return { result: null }; // signals Monaco to use its default range
      }
      if ("range" in raw) {
        const placeholder = (raw as { placeholder?: string }).placeholder;
        return {
          result: {
            range: raw.range,
            ...(placeholder !== undefined ? { placeholder } : {}),
          },
        };
      }
      // Bare Range
      return { result: { range: raw as LspRange } };
    } catch {
      return { result: null };
    }
  }

  async rename(params: {
    workspacePath: string;
    uri: string;
    languageId: string;
    line: number;
    character: number;
    newName: string;
  }): Promise<{ edit: LspWorkspaceEdit | null }> {
    if (!this.isAllowed(params.workspacePath)) return { edit: null };
    const entry = this.registry.find(params.workspacePath, params.languageId);
    if (!entry || entry.status !== "ready" || !entry.process) return { edit: null };

    try {
      const raw = (await entry.process.request("textDocument/rename", {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        newName: params.newName,
      })) as
        | { changes?: Record<string, unknown[]>; documentChanges?: unknown[] }
        | null;

      if (!raw) return { edit: null };

      // The spec allows `documentChanges` (with versioning + create/rename
      // file ops) instead of `changes`. We currently only handle plain
      // text edits — flatten documentChanges to changes when present, drop
      // any non-text ops. Most rename results don't use documentChanges.
      const changes: Record<string, Array<{ range: LspRange; newText: string }>> = {};
      if (raw.changes && typeof raw.changes === "object") {
        for (const [uri, edits] of Object.entries(raw.changes)) {
          if (!Array.isArray(edits)) continue;
          changes[uri] = edits
            .filter((e): e is { range: LspRange; newText: string } =>
              !!e && typeof e === "object" && "range" in e && "newText" in e,
            );
        }
      } else if (Array.isArray(raw.documentChanges)) {
        for (const dc of raw.documentChanges) {
          if (!dc || typeof dc !== "object") continue;
          const tdc = dc as {
            textDocument?: { uri?: string };
            edits?: Array<{ range: LspRange; newText: string }>;
          };
          const uri = tdc.textDocument?.uri;
          if (!uri || !Array.isArray(tdc.edits)) continue;
          (changes[uri] ??= []).push(
            ...tdc.edits.filter(
              (e): e is { range: LspRange; newText: string } =>
                !!e && "range" in e && "newText" in e,
            ),
          );
        }
      }

      return { edit: { changes } };
    } catch {
      return { edit: null };
    }
  }
}

/**
 * Normalize a raw completion item from the server. Strips fields the
 * webview doesn't use (notably `data` for completionItem/resolve, which
 * Phase 3 doesn't implement) and unwraps the various MarkupContent
 * shapes for documentation. Returns null if the item is malformed.
 */
function normalizeCompletionItem(raw: unknown): LspCompletionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== "string") return null;

  const item: LspCompletionItem = { label: r.label };
  if (typeof r.kind === "number") item.kind = r.kind as LspCompletionItem["kind"];
  if (typeof r.detail === "string") item.detail = r.detail;
  if (typeof r.documentation === "string") {
    item.documentation = r.documentation;
  } else if (r.documentation && typeof r.documentation === "object") {
    const d = r.documentation as { value?: string };
    if (typeof d.value === "string") item.documentation = d.value;
  }
  if (typeof r.insertText === "string") item.insertText = r.insertText;
  if (r.insertTextFormat === 1 || r.insertTextFormat === 2) {
    item.insertTextFormat = r.insertTextFormat;
  }
  // textEdit, when present, takes precedence over insertText. We translate
  // its range/newText into our shape so the provider can hand both fields
  // to Monaco (Monaco picks insertText if no range is supplied, range
  // if both).
  const textEdit = r.textEdit as { range?: LspRange; newText?: string } | undefined;
  if (textEdit?.range && typeof textEdit.newText === "string") {
    item.range = textEdit.range;
    item.insertText = textEdit.newText;
  }
  if (typeof r.sortText === "string") item.sortText = r.sortText;
  if (typeof r.filterText === "string") item.filterText = r.filterText;
  return item;
}

/** Recursively normalize a DocumentSymbol tree. Drops malformed nodes. */
function normalizeSymbol(raw: unknown): LspDocumentSymbol | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.kind !== "number") return null;
  if (!r.range || !r.selectionRange) return null;
  const sym: LspDocumentSymbol = {
    name: r.name,
    kind: r.kind,
    range: r.range as LspRange,
    selectionRange: r.selectionRange as LspRange,
  };
  if (typeof r.detail === "string") sym.detail = r.detail;
  if (Array.isArray(r.children)) {
    sym.children = r.children.map(normalizeSymbol).filter((c): c is LspDocumentSymbol => !!c);
  }
  return sym;
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
