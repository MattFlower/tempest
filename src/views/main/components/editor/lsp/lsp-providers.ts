// ============================================================
// LSP-backed Monaco providers.
//
// Hover and Go-to-Definition are global per-language registrations: one
// provider for "typescript" handles every TS file in every editor. We
// register them once at the first MonacoEditorPane mount and dispose
// them when the last MonacoEditorPane unmounts (tracked via a refcount).
//
// Each provider extracts (workspacePath, languageId) from the model's
// metadata and proxies the Monaco request through to Bun via the api
// surface. The bridge in lsp-bridge.ts owns document-sync; this module
// is a stateless translator.
// ============================================================

import type { Monaco, OnMount } from "@monaco-editor/react";
import type {
  editor as MonacoEditor,
  IDisposable,
  IPosition,
  IRange,
  languages,
  CancellationToken,
} from "monaco-editor";
import { api } from "../../../state/rpc-client";
import type {
  LspCodeAction,
  LspCompletionItem,
  LspDocumentSymbol,
  LspInlayHint,
  LspInlayHintLabelPart,
  LspLocation,
  LspRange,
  LspSignatureHelp,
  LspWorkspaceEdit,
} from "../../../../../shared/ipc-types";

/**
 * Per-model context that the providers need but Monaco doesn't natively
 * track. We keep a side-table keyed by model URI string. Refcounted: two
 * MonacoEditorPanes for the same file (e.g. the same file opened in two
 * splits) both call register, but the second pane unmounting must NOT
 * delete the entry the first pane is still relying on. Only the last
 * release removes the entry.
 */
interface ModelCtxEntry {
  workspacePath: string;
  languageId: string;
  refcount: number;
}
const modelContext = new Map<string, ModelCtxEntry>();

export function registerModelContext(
  model: MonacoEditor.ITextModel,
  workspacePath: string,
  languageId: string,
): () => void {
  const key = model.uri.toString();
  const existing = modelContext.get(key);
  if (existing) {
    existing.refcount += 1;
  } else {
    modelContext.set(key, { workspacePath, languageId, refcount: 1 });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const ctx = modelContext.get(key);
    if (!ctx) return;
    ctx.refcount -= 1;
    if (ctx.refcount <= 0) modelContext.delete(key);
  };
}

/**
 * Handle a model's `getLanguageId()` returning the wrong id when Monaco
 * disambiguates between TypeScript and JSX/TSX. We always trust the
 * registered context first.
 */
function ctxFor(model: MonacoEditor.ITextModel): { workspacePath: string; languageId: string } | undefined {
  return modelContext.get(model.uri.toString());
}

let registeredLanguages = new Set<string>();
let disposables: IDisposable[] = [];
let refcount = 0;

/**
 * Register hover + definition providers for the languages we want LSP to
 * back. Reference-counted: each MonacoEditorPane that uses LSP calls
 * `acquire()` on mount and the returned `release()` on unmount; providers
 * are torn down when the last pane releases.
 */
export function acquireLspProviders(monaco: Monaco): () => void {
  if (refcount === 0) install(monaco);
  refcount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refcount -= 1;
    if (refcount === 0) uninstall();
  };
}

/**
 * Monaco language ids we register hover/definition providers for. Must be
 * kept in sync with the `languageIds` arrays in src/bun/lsp/recipes.ts —
 * if a recipe's language isn't listed here, Monaco never asks our LSP for
 * hovers in that file and the user sees nothing despite the server running.
 *
 * Listing a language here for which no recipe exists is harmless: the
 * provider's first step is a context lookup that returns null when no
 * MonacoEditorPane has registered LSP context for the model.
 */
const SUPPORTED_LANGUAGES = [
  // NPM bucket
  "typescript", "javascript", "typescriptreact", "javascriptreact",
  "python",
  "html",
  "css", "scss", "less",
  "json", "jsonc",
  "shell",
  "yaml",
  "dockerfile",
  // GitHub bucket
  "rust",
  "lua",
  "c", "cpp",
  "markdown",
  // Toolchain bucket
  "go",
  // System bucket
  "java",
];

function install(monaco: Monaco): void {
  for (const lang of SUPPORTED_LANGUAGES) {
    if (registeredLanguages.has(lang)) continue;
    registeredLanguages.add(lang);

    disposables.push(
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model: MonacoEditor.ITextModel, position: IPosition) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          // Monaco uses 1-based line/column; LSP uses 0-based.
          const result = await api.lspHover({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
          });
          if (!result.result) return null;
          const r = result.result;
          const hover: languages.Hover = {
            contents: r.contents.map((value: string) => ({ value })),
            ...(r.range ? { range: lspRangeToMonaco(monaco, r.range) } : {}),
          };
          return hover;
        },
      }),
    );

    disposables.push(
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model: MonacoEditor.ITextModel, position: IPosition) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const result = await api.lspDefinition({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
          });
          if (result.locations.length === 0) return null;
          return result.locations.map((loc: LspLocation) => lspLocationToMonaco(monaco, loc));
        },
      }),
    );

    // --- Completions ---
    // Trigger characters: most servers respond on `.` (member access in
    // every C-family / TS / Python / etc.). Servers advertise their full
    // list in `initialize`'s capabilities; threading those through to
    // Monaco at provider-registration time would require an extra
    // round-trip per server. `.` covers the dominant cases for Phase 3;
    // Monaco still calls `provideCompletionItems` on every keystroke, so
    // missing trigger chars only affect the auto-popup behaviour, not
    // whether completions can be invoked.
    disposables.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [".", ":", "<", "/", "@", "\"", "'"],
        provideCompletionItems: async (
          model: MonacoEditor.ITextModel,
          position: IPosition,
          context: languages.CompletionContext,
          token: CancellationToken,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const reqParams: Parameters<typeof api.lspCompletion>[0] = {
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
          };
          if (context.triggerCharacter) {
            reqParams.triggerCharacter = context.triggerCharacter;
          }
          const result = await api.lspCompletion(reqParams);
          // Cancellation: Monaco fires a fresh request on every keystroke
          // and cancels the prior token. We don't yet send LSP's
          // $/cancelRequest (that's a Phase 4 concern), but discarding
          // stale results here is enough to keep the UI from flashing
          // outdated suggestions over fresh ones.
          if (token.isCancellationRequested) return null;
          if (!result.result) return null;

          const wordRange = wordAtPosition(monaco, model, position);
          const suggestions = result.result.items.map((item: LspCompletionItem) =>
            lspCompletionItemToMonaco(monaco, item, wordRange),
          );
          return {
            suggestions,
            incomplete: result.result.isIncomplete,
          } satisfies languages.CompletionList;
        },
      }),
    );

    // --- Find references ---
    disposables.push(
      monaco.languages.registerReferenceProvider(lang, {
        provideReferences: async (
          model: MonacoEditor.ITextModel,
          position: IPosition,
          context: languages.ReferenceContext,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const result = await api.lspReferences({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
            includeDeclaration: context.includeDeclaration,
          });
          if (result.locations.length === 0) return null;
          return result.locations.map((loc: LspLocation) => lspLocationToMonaco(monaco, loc));
        },
      }),
    );

    // --- Document symbols (outline / breadcrumbs) ---
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(lang, {
        // displayName shown in the outline view's header.
        displayName: "LSP",
        provideDocumentSymbols: async (model: MonacoEditor.ITextModel) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const result = await api.lspDocumentSymbols({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
          });
          if (result.symbols.length === 0) return null;
          return result.symbols.map((s: LspDocumentSymbol) => lspSymbolToMonaco(monaco, s));
        },
      }),
    );

    // --- Rename ---
    disposables.push(
      monaco.languages.registerRenameProvider(lang, {
        // resolveRenameLocation is optional but lets the server reject
        // rename requests on non-symbols (e.g. literals) before the user
        // sees the rename input box.
        resolveRenameLocation: async (
          model: MonacoEditor.ITextModel,
          position: IPosition,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return { rejectReason: "No LSP context for this file" };
          const result = await api.lspPrepareRename({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
          });
          if (!result.result) {
            // Server returned null — either the symbol can't be renamed
            // or it wants Monaco to use its default (word-at-cursor)
            // range. Our shared lspPrepareRename normalizes the spec's
            // `{ defaultBehavior: true }` to null too. Fall back to the
            // word-at-cursor heuristic.
            const wordInfo = model.getWordAtPosition(position);
            if (!wordInfo) return { rejectReason: "Can't rename here" };
            return {
              range: new monaco.Range(
                position.lineNumber, wordInfo.startColumn,
                position.lineNumber, wordInfo.endColumn,
              ),
              text: wordInfo.word,
            };
          }
          return {
            range: lspRangeToMonaco(monaco, result.result.range),
            text: result.result.placeholder ?? model.getValueInRange(
              lspRangeToMonaco(monaco, result.result.range),
            ),
          };
        },
        provideRenameEdits: async (
          model: MonacoEditor.ITextModel,
          position: IPosition,
          newName: string,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return { edits: [] };
          const result = await api.lspRename({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
            newName,
          });
          if (!result.edit) return { edits: [] };
          return await applyWorkspaceEdit(monaco, result.edit);
        },
      }),
    );

    // --- Signature help ---
    // Trigger characters: `(` opens the popup at function-call sites,
    // `,` advances to the next parameter. Most servers accept these.
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [")"],
        provideSignatureHelp: async (
          model: MonacoEditor.ITextModel,
          position: IPosition,
          _token: CancellationToken,
          context: languages.SignatureHelpContext,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const reqParams: Parameters<typeof api.lspSignatureHelp>[0] = {
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            line: position.lineNumber - 1,
            character: position.column - 1,
            isRetrigger: context.isRetrigger,
          };
          if (context.triggerCharacter) {
            reqParams.triggerCharacter = context.triggerCharacter;
          }
          const result = await api.lspSignatureHelp(reqParams);
          if (!result.result) return null;
          return {
            value: lspSignatureHelpToMonaco(result.result),
            // Phase 4 v1 has no resolve step; dispose is a no-op so
            // Monaco doesn't try to free anything we don't own.
            dispose: () => { /* no-op */ },
          };
        },
      }),
    );

    // --- Inlay hints ---
    disposables.push(
      monaco.languages.registerInlayHintsProvider(lang, {
        provideInlayHints: async (
          model: MonacoEditor.ITextModel,
          range: IRange,
          _token: CancellationToken,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          const result = await api.lspInlayHints({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            range: monacoRangeToLsp(range),
          });
          if (result.hints.length === 0) return null;
          return {
            hints: result.hints.map((h: LspInlayHint) => lspInlayHintToMonaco(monaco, h)),
            // Phase 4 v1 has no resolve step.
            dispose: () => { /* no-op */ },
          };
        },
      }),
    );

    // --- Code actions ---
    disposables.push(
      monaco.languages.registerCodeActionProvider(lang, {
        provideCodeActions: async (
          model: MonacoEditor.ITextModel,
          range: IRange,
          context: languages.CodeActionContext,
        ) => {
          const ctx = ctxFor(model);
          if (!ctx) return null;
          // Monaco's CodeActionContext gives us the diagnostics on the
          // range plus an optional `only` filter (used when invoking via
          // a specific kind like "refactor"). Forward both — the server
          // uses the diagnostics to compute quickfixes and `only` to
          // skip irrelevant kinds.
          const result = await api.lspCodeActions({
            workspacePath: ctx.workspacePath,
            uri: model.uri.toString(),
            languageId: ctx.languageId,
            range: monacoRangeToLsp(range),
            context: {
              diagnostics: context.markers
                .map((m) => monacoMarkerToLspDiagnostic(m))
                .filter((d) => !!d) as Array<NonNullable<ReturnType<typeof monacoMarkerToLspDiagnostic>>>,
              ...(context.only ? { only: [context.only] } : {}),
            },
          });
          if (result.actions.length === 0) return null;
          return {
            actions: result.actions.map((a: LspCodeAction) =>
              lspCodeActionToMonaco(monaco, a, ctx),
            ),
            dispose: () => { /* no-op */ },
          };
        },
      }),
    );
  }
}

function uninstall(): void {
  for (const d of disposables) {
    try { d.dispose(); } catch { /* ignore */ }
  }
  disposables = [];
  registeredLanguages = new Set();
}

function lspRangeToMonaco(monaco: Monaco, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function lspLocationToMonaco(monaco: Monaco, location: LspLocation) {
  return {
    uri: monaco.Uri.parse(location.uri),
    range: lspRangeToMonaco(monaco, location.range),
  };
}

/** Convert Monaco's 1-based IRange to LSP's 0-based LspRange. */
function monacoRangeToLsp(range: IRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}

/** Convert a Monaco IMarkerData (diagnostic) back to the LSP shape. Used
 *  by the code-action provider to forward diagnostics-on-the-range as
 *  context to the server. Returns null for markers that lack the LSP
 *  fields we need (shouldn't happen for our `tempest-lsp` markers). */
function monacoMarkerToLspDiagnostic(
  marker: MonacoEditor.IMarkerData,
):
  | {
      range: LspRange;
      severity?: 1 | 2 | 3 | 4;
      message: string;
      source?: string;
      code?: string | number;
    }
  | null {
  if (typeof marker.message !== "string") return null;
  // Monaco MarkerSeverity → LSP DiagnosticSeverity:
  //   Monaco: Hint=1, Info=2, Warning=4, Error=8
  //   LSP:    Error=1, Warning=2, Info=3, Hint=4
  let severity: 1 | 2 | 3 | 4 | undefined;
  switch (marker.severity) {
    case 8: severity = 1; break;
    case 4: severity = 2; break;
    case 2: severity = 3; break;
    case 1: severity = 4; break;
  }
  return {
    range: {
      start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
      end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
    },
    message: marker.message,
    ...(severity !== undefined ? { severity } : {}),
    ...(typeof marker.source === "string" ? { source: marker.source } : {}),
    ...(marker.code !== undefined
      ? { code: typeof marker.code === "string" || typeof marker.code === "number"
            ? marker.code
            : String(marker.code) }
      : {}),
  };
}

/** Convert an LSP SignatureHelp into Monaco's matching shape. The two
 *  are nearly identical — the only delta is parameter labels: LSP
 *  uses `[start, end]` offsets into the signature label; Monaco
 *  accepts the same shape directly when `parameterInformation.label`
 *  is a tuple. */
function lspSignatureHelpToMonaco(help: LspSignatureHelp): languages.SignatureHelp {
  return {
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
    signatures: help.signatures.map((s) => ({
      label: s.label,
      ...(s.documentation ? { documentation: { value: s.documentation } } : {}),
      ...(typeof s.activeParameter === "number"
        ? { activeParameter: s.activeParameter }
        : {}),
      parameters: s.parameters.map((p) => ({
        label: p.label,
        ...(p.documentation ? { documentation: { value: p.documentation } } : {}),
      })),
    })),
  };
}

/** Convert an LSP InlayHint to Monaco's. Monaco's label can be a string
 *  or `InlayHintLabelPart[]`; both the spec and Monaco use the same
 *  variant, so it's a near-identity mapping. */
function lspInlayHintToMonaco(monaco: Monaco, hint: LspInlayHint): languages.InlayHint {
  const out: languages.InlayHint = {
    position: {
      lineNumber: hint.position.line + 1,
      column: hint.position.character + 1,
    },
    label: typeof hint.label === "string"
      ? hint.label
      : hint.label.map((p: LspInlayHintLabelPart) => ({
          label: p.value,
          ...(p.tooltip ? { tooltip: p.tooltip } : {}),
        })),
  };
  if (hint.kind !== undefined) {
    // Monaco's InlayHintKind: Type=1, Parameter=2 — same numbering as LSP.
    out.kind = hint.kind as languages.InlayHintKind;
  }
  if (hint.tooltip) out.tooltip = { value: hint.tooltip };
  if (hint.paddingLeft !== undefined) out.paddingLeft = hint.paddingLeft;
  if (hint.paddingRight !== undefined) out.paddingRight = hint.paddingRight;
  // Suppress unused-monaco param warning while keeping the signature open
  // for future enhancements (e.g. snippet-aware label conversions).
  void monaco;
  return out;
}

/** Convert an LSP CodeAction into Monaco's. For `edit`-bearing actions
 *  we translate the WorkspaceEdit shape lazily on apply; for `command`
 *  actions we synthesize a Monaco Command that, when invoked, sends
 *  workspace/executeCommand back to the server. */
function lspCodeActionToMonaco(
  monaco: Monaco,
  action: LspCodeAction,
  ctx: { workspacePath: string; languageId: string },
): languages.CodeAction {
  const out: languages.CodeAction = {
    title: action.title,
    ...(action.kind ? { kind: action.kind } : {}),
    ...(typeof action.isPreferred === "boolean"
      ? { isPreferred: action.isPreferred }
      : {}),
  };

  // `edit`-bearing action: synthesize a Monaco WorkspaceEdit from the
  // LSP one, ignoring out-of-model edits for the synchronous return. The
  // command path below also fires applyWorkspaceEdit for any returned
  // edits, so this still works end-to-end for tsserver actions like
  // "Add missing import" that have edit but no command.
  if (action.edit) {
    out.edit = synthesizeMonacoEdit(monaco, action.edit);
  }

  if (action.command) {
    // Register an inline Monaco command id that, when invoked, sends
    // workspace/executeCommand to the server and applies any returned
    // edit. `monaco.editor.registerCommand` is global and adds a one-off
    // command-id binding; we use a unique id so multiple actions don't
    // collide.
    const commandId = `tempest.lsp.executeCommand.${
      action.command.command
    }.${Math.random().toString(36).slice(2, 10)}`;
    monaco.editor.addCommand({
      id: commandId,
      run: async () => {
        if (!action.command) return;
        const result = await api.lspExecuteCommand({
          workspacePath: ctx.workspacePath,
          languageId: ctx.languageId,
          command: action.command.command,
          ...(action.command.arguments ? { arguments: action.command.arguments } : {}),
        });
        if (result.edit) {
          await applyWorkspaceEdit(monaco, result.edit);
        }
      },
    });
    out.command = {
      id: commandId,
      title: action.command.title,
      ...(action.command.arguments ? { arguments: action.command.arguments } : {}),
    };
  }
  return out;
}

/** Same shape as applyWorkspaceEdit's return value, computed
 *  synchronously for use in the CodeAction's `.edit` field (Monaco
 *  applies it inline when the user picks the action). Out-of-model
 *  writes are still kicked off in the background by applyWorkspaceEdit
 *  if needed; here we just return the in-model edits Monaco can apply
 *  immediately. */
function synthesizeMonacoEdit(
  monaco: Monaco,
  edit: LspWorkspaceEdit,
): languages.WorkspaceEdit {
  const monacoEdits: languages.IWorkspaceTextEdit[] = [];
  for (const [uriStr, edits] of Object.entries(edit.changes)) {
    if (edits.length === 0) continue;
    const uri = monaco.Uri.parse(uriStr);
    const model = monaco.editor.getModel(uri);
    if (!model) {
      // Out-of-model edit: kick off the background write. Monaco won't
      // see this edit but the file is still updated on disk.
      void writeOutOfModelEdits(uriStr, edits);
      continue;
    }
    for (const e of edits) {
      monacoEdits.push({
        resource: uri,
        textEdit: {
          range: lspRangeToMonaco(monaco, e.range),
          text: e.newText,
        },
        versionId: undefined,
      });
    }
  }
  return { edits: monacoEdits };
}

/** Compute Monaco's word range at the given position, used as the default
 *  insert range for completion items that don't carry their own textEdit. */
function wordAtPosition(
  monaco: Monaco,
  model: MonacoEditor.ITextModel,
  position: IPosition,
): IRange {
  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber, word.startColumn,
    position.lineNumber, word.endColumn,
  );
}

/**
 * Convert an LSP CompletionItemKind (1-based) to Monaco's
 * CompletionItemKind enum (different numeric layout). Falls back to
 * Text when the server uses a kind we don't recognize.
 */
function lspKindToMonacoKind(
  monaco: Monaco,
  lspKind: number | undefined,
): languages.CompletionItemKind {
  const k = monaco.languages.CompletionItemKind;
  switch (lspKind) {
    case 1: return k.Text;
    case 2: return k.Method;
    case 3: return k.Function;
    case 4: return k.Constructor;
    case 5: return k.Field;
    case 6: return k.Variable;
    case 7: return k.Class;
    case 8: return k.Interface;
    case 9: return k.Module;
    case 10: return k.Property;
    case 11: return k.Unit;
    case 12: return k.Value;
    case 13: return k.Enum;
    case 14: return k.Keyword;
    case 15: return k.Snippet;
    case 16: return k.Color;
    case 17: return k.File;
    case 18: return k.Reference;
    case 19: return k.Folder;
    case 20: return k.EnumMember;
    case 21: return k.Constant;
    case 22: return k.Struct;
    case 23: return k.Event;
    case 24: return k.Operator;
    case 25: return k.TypeParameter;
    default: return k.Text;
  }
}

function lspCompletionItemToMonaco(
  monaco: Monaco,
  item: LspCompletionItem,
  defaultRange: IRange,
): languages.CompletionItem {
  const range = item.range ? lspRangeToMonaco(monaco, item.range) : defaultRange;
  const monacoItem: languages.CompletionItem = {
    label: item.label,
    kind: lspKindToMonacoKind(monaco, item.kind),
    insertText: item.insertText ?? item.label,
    range,
  };
  // insertTextFormat 2 = Snippet — Monaco's InsertAsSnippet rule lets the
  // editor expand $1, $2 placeholders in the inserted text. Without this
  // the user sees the literal `$1` markers.
  if (item.insertTextFormat === 2) {
    monacoItem.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }
  if (item.detail) monacoItem.detail = item.detail;
  if (item.documentation) {
    // Treat docs as markdown — most servers send markdown anyway.
    monacoItem.documentation = { value: item.documentation };
  }
  if (item.sortText) monacoItem.sortText = item.sortText;
  if (item.filterText) monacoItem.filterText = item.filterText;
  return monacoItem;
}

/** Recursively map an LSP DocumentSymbol tree into Monaco's. The two
 *  shapes are nearly identical; the kind enum is also numerically
 *  compatible (Monaco's SymbolKind matches the LSP spec). */
function lspSymbolToMonaco(
  monaco: Monaco,
  s: LspDocumentSymbol,
): languages.DocumentSymbol {
  const out: languages.DocumentSymbol = {
    name: s.name,
    detail: s.detail ?? "",
    kind: s.kind as languages.SymbolKind,
    tags: [],
    range: lspRangeToMonaco(monaco, s.range),
    selectionRange: lspRangeToMonaco(monaco, s.selectionRange),
  };
  if (s.children && s.children.length > 0) {
    out.children = s.children.map((c) => lspSymbolToMonaco(monaco, c));
  }
  return out;
}

/**
 * Apply an LSP WorkspaceEdit (typically the result of a rename).
 *
 * Strategy:
 *   - URIs that have an existing Monaco model: include in the edits
 *     returned to Monaco's bulk-edit machinery, which applies them
 *     atomically with proper undo/redo.
 *   - URIs without a Monaco model: read the file via the existing
 *     editor RPCs, transform the text in memory, write it back.
 *     These edits don't participate in Monaco's undo stack.
 *
 * Splitting the workload like this avoids two pitfalls: (a) creating
 * Monaco models for every affected file (which would silently keep
 * those models alive beyond the rename) and (b) registering Monaco's
 * editor opener for cross-file edits (which would spawn a new tab per
 * affected file, even if the user never wanted to look at them).
 */
async function applyWorkspaceEdit(
  monaco: Monaco,
  edit: LspWorkspaceEdit,
): Promise<languages.WorkspaceEdit> {
  const monacoEdits: languages.IWorkspaceTextEdit[] = [];

  // Collect out-of-model writes to perform after Monaco's edits land —
  // doing them in parallel before/during would race with any Monaco edit
  // path that might also touch the same file.
  const outOfModel: Array<{ uri: string; lspEdits: LspWorkspaceEdit["changes"][string] }> = [];

  for (const [uriStr, edits] of Object.entries(edit.changes)) {
    if (edits.length === 0) continue;
    const uri = monaco.Uri.parse(uriStr);
    const model = monaco.editor.getModel(uri);
    if (model) {
      for (const e of edits) {
        monacoEdits.push({
          resource: uri,
          textEdit: {
            range: lspRangeToMonaco(monaco, e.range),
            text: e.newText,
          },
          versionId: undefined,
        });
      }
    } else {
      outOfModel.push({ uri: uriStr, lspEdits: edits });
    }
  }

  // Fire-and-forget the out-of-model writes. We don't await before
  // returning the WorkspaceEdit because Monaco wants the result
  // synchronously enough that blocking on file I/O would feel laggy
  // — instead the writes happen in the background and the user sees
  // affected files update on next refresh.
  for (const { uri, lspEdits } of outOfModel) {
    void writeOutOfModelEdits(uri, lspEdits);
  }

  return { edits: monacoEdits };
}

/**
 * Read a file, apply LSP text edits in reverse order (so earlier
 * edit ranges aren't invalidated by later inserts), write it back.
 * Reverse order matters because LSP edits are specified in source
 * coordinates and must be applied right-to-left to keep ranges valid.
 */
async function writeOutOfModelEdits(
  uri: string,
  edits: LspWorkspaceEdit["changes"][string],
): Promise<void> {
  // Strip the file:// prefix to get a usable filesystem path. Both
  // readFileForEditor and writeFileForEditor expect plain absolute paths.
  const filePath = uri.replace(/^file:\/\//, "");
  try {
    const { content } = await api.readFileForEditor(filePath);
    const updated = applyEditsToText(content, edits);
    await api.writeFileForEditor(filePath, updated);
  } catch (err) {
    console.error("[lsp] failed to apply out-of-model edits to", filePath, err);
  }
}

function applyEditsToText(
  text: string,
  edits: LspWorkspaceEdit["changes"][string],
): string {
  // Sort edits by start position descending. Each edit's range is
  // expressed in original-text coordinates; applying back-to-front keeps
  // the offsets of unprocessed edits valid.
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  // Build a per-line offset table once — text → lines, then translate
  // (line, character) into a flat offset.
  const lines = text.split(/\r?\n/);
  const eolLengths = computeEolLengths(text);
  const lineStartOffsets = computeLineStartOffsets(lines, eolLengths);

  let out = text;
  for (const e of sorted) {
    // Defensive: skip edits that point beyond the file's last line. Should
    // never happen for a well-formed LSP response, but tsc's
    // `noUncheckedIndexedAccess` makes us narrow `lineStartOffsets[N]`
    // to `number | undefined` and we'd rather drop a malformed edit than
    // crash the whole rename.
    const startLineOffset = lineStartOffsets[e.range.start.line];
    const endLineOffset = lineStartOffsets[e.range.end.line];
    if (startLineOffset === undefined || endLineOffset === undefined) continue;
    const startOffset = startLineOffset + e.range.start.character;
    const endOffset = endLineOffset + e.range.end.character;
    out = out.slice(0, startOffset) + e.newText + out.slice(endOffset);
  }
  return out;
}

/** Returns a Uint8Array per line giving the EOL byte count after that
 *  line. Used to translate (line, char) into a string offset that
 *  respects mixed line endings (rare but possible in code). */
function computeEolLengths(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const newline = text.indexOf("\n", i);
    if (newline === -1) {
      out.push(0);
      break;
    }
    if (newline > 0 && text[newline - 1] === "\r") {
      out.push(2); // \r\n
    } else {
      out.push(1); // \n
    }
    i = newline + 1;
  }
  return out;
}

function computeLineStartOffsets(lines: string[], eolLengths: number[]): number[] {
  const offsets: number[] = new Array(lines.length);
  offsets[0] = 0;
  for (let i = 1; i < lines.length; i++) {
    offsets[i] = (offsets[i - 1] ?? 0) + (lines[i - 1]?.length ?? 0) + (eolLengths[i - 1] ?? 1);
  }
  return offsets;
}

/** Hook called from a MonacoEditorPane's onMount. Convenience wrapper. */
export type LspMountArg = Parameters<OnMount>[1];
