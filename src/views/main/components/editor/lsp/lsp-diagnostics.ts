// ============================================================
// LSP diagnostics → Monaco markers.
//
// One module-level subscription consumes every `lspDiagnostics` push and
// applies the markers to the matching Monaco model. We can't apply markers
// to a model that hasn't been created yet, so when the push arrives before
// the editor mounts we cache the latest set per uri and replay on the
// next model registration.
// ============================================================

import type { editor as MonacoEditor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";
import type { LspDiagnostic } from "../../../../../shared/ipc-types";

const MARKER_OWNER = "tempest-lsp";

const pendingByUri = new Map<string, LspDiagnostic[]>();
let monacoRef: Monaco | null = null;

/**
 * Apply diagnostics to the model that matches this uri, if any. If the
 * model isn't created yet, cache so a later registerDiagnosticsModel()
 * picks it up on mount.
 */
export function applyDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
  pendingByUri.set(uri, diagnostics);
  if (!monacoRef) return;
  const model = findModelByUri(monacoRef, uri);
  if (!model) return;
  monacoRef.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    diagnostics.map(toMarker),
  );
}

/**
 * Called once on first editor mount to capture the Monaco namespace and
 * flush any diagnostics that arrived before any editor existed.
 */
export function bindMonacoForDiagnostics(monaco: Monaco): void {
  monacoRef = monaco;
  for (const [uri, diags] of pendingByUri) {
    const model = findModelByUri(monaco, uri);
    if (!model) continue;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, diags.map(toMarker));
  }
}

/**
 * When a Monaco model for a known uri is freshly created (a tab opening),
 * apply any cached diagnostics. The provider attachment site calls this
 * after creating/discovering the model.
 */
export function flushDiagnosticsFor(monaco: Monaco, model: MonacoEditor.ITextModel): void {
  const uri = model.uri.toString();
  const cached = pendingByUri.get(uri);
  if (!cached) return;
  monaco.editor.setModelMarkers(model, MARKER_OWNER, cached.map(toMarker));
}

/**
 * Clear all markers (e.g. when LSP is disabled). Doesn't drop the cache —
 * a re-enable with the same docs will re-apply when fresh diagnostics
 * push from the server.
 */
export function clearAllMarkers(monaco: Monaco): void {
  for (const model of monaco.editor.getModels()) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  }
}

function findModelByUri(monaco: Monaco, uri: string): MonacoEditor.ITextModel | undefined {
  return monaco.editor.getModels().find((m: MonacoEditor.ITextModel) => m.uri.toString() === uri);
}

function toMarker(d: LspDiagnostic): MonacoEditor.IMarkerData {
  return {
    severity: lspSeverityToMonaco(d.severity),
    message: d.message,
    code: d.code !== undefined ? String(d.code) : undefined,
    source: d.source,
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
  };
}

function lspSeverityToMonaco(s: LspDiagnostic["severity"]): MonacoEditor.IMarkerData["severity"] {
  // monaco.MarkerSeverity values: Hint=1, Info=2, Warning=4, Error=8.
  // We can't import the enum from a static module without pulling
  // monaco-editor in eagerly, so use the literal numbers. They're stable.
  switch (s) {
    case 1: return 8; // Error
    case 2: return 4; // Warning
    case 3: return 2; // Info
    case 4: return 1; // Hint
    default: return 8; // unspecified → treat as error so it's noticed
  }
}
