// ============================================================
// LSP bridge — attach a Monaco model to the Bun-side language server.
//
// The bridge owns the document-sync lifecycle for one Monaco model:
//   - on attach: send didOpen with the current text
//   - on every content change: send a debounced didChange
//   - on detach: flush any pending didChange, then send didClose
//
// It does NOT register hover/definition providers — those are global
// (per Monaco language) and live in lsp-providers.ts. The bridge's job
// is purely to keep the server's view of this document in sync with
// the editor.
// ============================================================

import type { editor as MonacoEditor, IDisposable } from "monaco-editor";
import { api } from "../../../state/rpc-client";

const DIDCHANGE_DEBOUNCE_MS = 150;

export interface LspBridgeHandle {
  dispose: () => void;
}

/**
 * Attach an LSP bridge to a Monaco model. Returns a handle whose
 * `dispose()` tears down listeners and notifies the server with didClose.
 *
 * The URI is read directly from the Monaco model rather than re-derived
 * from `filePath` — this is essential because the server identifies
 * documents by the exact URI string we sent in didOpen, and the hover/
 * definition providers query using `model.uri.toString()`. They must match.
 * The MonacoEditorPane passes `path={file://...}` to <Editor> so the
 * model URI ends up being a `file://` URI the language server can resolve.
 *
 * The version counter is per-uri-per-bridge; that's safe because we only
 * ever send synchronous edits from this one model.
 */
export function attachLsp(params: {
  model: MonacoEditor.ITextModel;
  workspacePath: string;
  languageId: string;
}): LspBridgeHandle {
  const { model, workspacePath, languageId } = params;
  const uri = model.uri.toString();
  let version = 1;

  // Temporary diagnostic logging. Phase 1 is wired up via this URI; if it
  // doesn't start with `file://`, the language server won't be able to find
  // the document and hover/definition will silently return nothing.
  console.log("[lsp-bridge] attaching", { uri, workspacePath, languageId });

  // Initial didOpen with the current text. The Bun side may need to
  // spawn the server lazily on first didOpen — that work is fire-and-
  // forget so we don't block the editor mount.
  void api.lspDidOpen({
    workspacePath,
    uri,
    languageId,
    version,
    text: model.getValue(),
  });

  // Debounce didChange so a rapid sequence of keystrokes coalesces into
  // one notification. The server still gets every version eventually —
  // we only delay the notify, never skip one.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (debounceTimer === null) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    version += 1;
    void api.lspDidChange({
      workspacePath,
      uri,
      languageId,
      version,
      text: model.getValue(),
    });
  };

  const subscription: IDisposable = model.onDidChangeContent(() => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DIDCHANGE_DEBOUNCE_MS);
  });

  return {
    dispose: () => {
      // Flush any pending change so the server doesn't carry stale
      // text after we close the document.
      flush();
      subscription.dispose();
      void api.lspDidClose({ workspacePath, uri, languageId });
    },
  };
}
