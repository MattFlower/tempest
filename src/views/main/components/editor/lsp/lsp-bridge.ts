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

// We send didChange synchronously on every onDidChangeContent. Monaco
// fires auto-triggers (signature help on `(`, completion on `.`, etc.)
// in the same tick as the content change — if we debounced didChange,
// those follow-up requests would race ahead of the version we just
// edited and the server would respond against stale text. Removing the
// debounce costs one RPC per keystroke (~1 ms round trip), which is
// well below the threshold where it would feel laggy or strain the
// server.
//
// During pastes / large edits onDidChangeContent fires once with the
// whole change; we're not amplifying that case either.

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

  // Send didChange synchronously on every content change. The Bun-side
  // RPC dispatcher preserves order, so by the time any subsequent
  // request from this tick (e.g. an auto-fired signature help on `(`)
  // reaches the server, the didChange notification carrying the new
  // character has already been processed.
  bridge.contentSubscription = model.onDidChangeContent(() => {
    flushBridge(bridge);
  });

  sharedBridges.set(uri, bridge);
  return { dispose: () => releaseBridge(uri) };
}

function flushBridge(bridge: SharedBridge): void {
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

  // Last reference — tear down. Any pending changes have already been
  // flushed synchronously via onDidChangeContent.
  bridge.contentSubscription.dispose();
  void api.lspDidClose({
    workspacePath: bridge.workspacePath,
    uri: bridge.uri,
    languageId: bridge.languageId,
  });
  sharedBridges.delete(uri);
}
