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
  languages,
} from "monaco-editor";
import { api } from "../../../state/rpc-client";
import type { LspLocation, LspRange } from "../../../../../shared/ipc-types";

/**
 * Per-model context that the providers need but Monaco doesn't natively
 * track. We keep a side-table keyed by model URI string. Models removed
 * from this map fall through to Monaco's bundled behaviour automatically.
 */
const modelContext = new Map<string, { workspacePath: string; languageId: string }>();

export function registerModelContext(
  model: MonacoEditor.ITextModel,
  workspacePath: string,
  languageId: string,
): () => void {
  const key = model.uri.toString();
  modelContext.set(key, { workspacePath, languageId });
  return () => { modelContext.delete(key); };
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

/** Hook called from a MonacoEditorPane's onMount. Convenience wrapper. */
export type LspMountArg = Parameters<OnMount>[1];
