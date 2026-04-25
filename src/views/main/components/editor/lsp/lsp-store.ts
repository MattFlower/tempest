// ============================================================
// Webview-side LSP state.
//
// Holds a snapshot of every running server (pushed by Bun via
// lspServerStateChanged) plus the latest memory samples while the popover
// is open. The MonacoEditorPane uses isLspReady() to decide whether to
// disable Monaco's bundled TS service for a given file.
//
// This is a small dedicated store — adding LSP rows to the global zustand
// store would force every consumer of useStore to rerender on memory
// updates, and the data is only interesting to two components.
// ============================================================

import { create } from "zustand";
import type { LspServerState, LspMemorySample } from "../../../../../shared/ipc-types";

interface LspStoreState {
  servers: Record<string, LspServerState>;
  memoryByServer: Record<string, number | null>;
  applyServerState: (state: LspServerState) => void;
  applyMemorySamples: (samples: LspMemorySample[]) => void;
  clearMemory: () => void;
}

export const useLspStore = create<LspStoreState>((set) => ({
  servers: {},
  memoryByServer: {},
  applyServerState: (state) =>
    set((s) => {
      // Stopped servers stay in the map briefly so the popover can show
      // the final transition; the next "ready" or restart removes the row.
      // For the simpler v1 we just drop "stopped" rows immediately.
      if (state.status === "stopped") {
        const { [state.id]: _drop, ...rest } = s.servers;
        const { [state.id]: _m, ...mem } = s.memoryByServer;
        return { servers: rest, memoryByServer: mem };
      }
      return { servers: { ...s.servers, [state.id]: state } };
    }),
  applyMemorySamples: (samples) =>
    set((s) => {
      const next = { ...s.memoryByServer };
      for (const sample of samples) next[sample.serverId] = sample.rssBytes;
      return { memoryByServer: next };
    }),
  clearMemory: () => set({ memoryByServer: {} }),
}));

/**
 * True when there is a `ready` server for this (workspace, language). The
 * MonacoEditorPane consults this to decide whether to suppress Monaco's
 * bundled TypeScript service in favor of the project-aware language server.
 *
 * Note: this is a momentary read — if the server transitions to "error"
 * mid-edit, the editor doesn't dynamically re-enable Monaco's service. Any
 * stale state simply means a few moments without diagnostics; nothing
 * dangerous happens.
 */
export function isLspReady(workspacePath: string, languageId: string): boolean {
  // Map languageId → recipe key. The recipe lives Bun-side; we hardcode
  // the same group here. When phase 2 adds more recipes, we expose a
  // small helper from Bun via RPC instead.
  const recipeName = recipeForLanguageId(languageId);
  if (!recipeName) return false;
  const id = `${workspacePath}::${recipeName}`;
  const server = useLspStore.getState().servers[id];
  return server?.status === "ready";
}

const TS_LANGUAGES = new Set(["typescript", "javascript", "typescriptreact", "javascriptreact"]);

function recipeForLanguageId(languageId: string): string | undefined {
  if (TS_LANGUAGES.has(languageId)) return "typescript-language-server";
  return undefined;
}
