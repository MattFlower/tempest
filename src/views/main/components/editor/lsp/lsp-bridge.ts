// ============================================================
// LSP bridge — attach a Monaco model to the Bun-side language server.
//
// The bridge owns the document-sync lifecycle for one Monaco model:
//   - on first attach: send didOpen with the current text
//   - on every content change: send a debounced didChange
//   - on last detach: flush any pending didChange, then send didClose
//
// It does NOT register hover/definition providers — those are global
// (per Monaco language) and live in lsp-providers.ts. The bridge's job
// is purely to keep the server's view of this document in sync with
// the editor.
//
// Refcounting per URI: Monaco models are shared across editor panes
// (opening the same file in two splits reuses the same model). Without
// refcounting, both panes would attach onDidChangeContent listeners to
// the shared model — each firing didChange independently, with their own
// version counters drifting from each other and the server seeing
// version histories like 5, 3, 6, 4, ... Worse, when one pane unmounts,
// it sends didClose, telling the server the doc is gone — and the
// remaining pane silently breaks. The bridge is therefore keyed by URI
// and refcounted: the first pane creates the bridge; subsequent panes
// just bump the count; only the last release tears it down.
// ============================================================

import type { editor as MonacoEditor, IDisposable } from "monaco-editor";
import { api } from "../../../state/rpc-client";

const DIDCHANGE_DEBOUNCE_MS = 150;

export interface LspBridgeHandle {
  dispose: () => void;
}

interface SharedBridge {
  uri: string;
  workspacePath: string;
  languageId: string;
  /** Monaco model reference, used to read latest text in flush(). Models
   *  are shared across panes by URI — holding a reference doesn't
   *  prevent GC because we drop it when the bridge is torn down. */
  model: MonacoEditor.ITextModel;
  version: number;
  refcount: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  contentSubscription: IDisposable;
}

const sharedBridges = new Map<string, SharedBridge>(); // key: uri

/**
 * Attach an LSP bridge to a Monaco model. Returns a handle whose
 * `dispose()` decrements the refcount and (only on the last release)
 * sends didClose to the server.
 *
 * The URI is read directly from the Monaco model rather than re-derived
 * from `filePath` — this is essential because the server identifies
 * documents by the exact URI string we sent in didOpen, and the hover/
 * definition providers query using `model.uri.toString()`. They must match.
 * The MonacoEditorPane passes `path={file://...}` to <Editor> so the
 * model URI ends up being a `file://` URI the language server can resolve.
 */
export function attachLsp(params: {
  model: MonacoEditor.ITextModel;
  workspacePath: string;
  languageId: string;
}): LspBridgeHandle {
  const { model, workspacePath, languageId } = params;
  const uri = model.uri.toString();

  const existing = sharedBridges.get(uri);
  if (existing) {
    existing.refcount += 1;
    return { dispose: () => releaseBridge(uri) };
  }

  // First attach for this URI — set up the bridge.
  const bridge: SharedBridge = {
    uri,
    workspacePath,
    languageId,
    model,
    version: 1,
    refcount: 1,
    flushTimer: null,
    contentSubscription: undefined as unknown as IDisposable, // assigned below
  };

  // Initial didOpen with the current text. The Bun side may need to
  // spawn the server lazily on first didOpen — that work is fire-and-
  // forget so we don't block the editor mount.
  void api.lspDidOpen({
    workspacePath,
    uri,
    languageId,
    version: bridge.version,
    text: model.getValue(),
  });

  // Debounce didChange so a rapid sequence of keystrokes coalesces into
  // one notification. The server still gets every version eventually —
  // we only delay the notify, never skip one.
  bridge.contentSubscription = model.onDidChangeContent(() => {
    if (bridge.flushTimer !== null) clearTimeout(bridge.flushTimer);
    bridge.flushTimer = setTimeout(() => flushBridge(bridge), DIDCHANGE_DEBOUNCE_MS);
  });

  sharedBridges.set(uri, bridge);
  return { dispose: () => releaseBridge(uri) };
}

function flushBridge(bridge: SharedBridge): void {
  if (bridge.flushTimer === null) return;
  clearTimeout(bridge.flushTimer);
  bridge.flushTimer = null;
  bridge.version += 1;
  void api.lspDidChange({
    workspacePath: bridge.workspacePath,
    uri: bridge.uri,
    languageId: bridge.languageId,
    version: bridge.version,
    text: bridge.model.getValue(),
  });
}

function releaseBridge(uri: string): void {
  const bridge = sharedBridges.get(uri);
  if (!bridge) return;
  bridge.refcount -= 1;
  if (bridge.refcount > 0) return;

  // Last reference — flush any pending change so the server's view of
  // the document matches what was last on screen, then tear down.
  flushBridge(bridge);
  bridge.contentSubscription.dispose();
  void api.lspDidClose({
    workspacePath: bridge.workspacePath,
    uri: bridge.uri,
    languageId: bridge.languageId,
  });
  sharedBridges.delete(uri);
}
