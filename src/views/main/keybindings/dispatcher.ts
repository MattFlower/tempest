// Global keybinding dispatcher.
//
// Listens to `keydown` at the window level. Resolves the effective binding
// table from the command registry overlaid with user overrides in the Zustand
// store, then dispatches the matching command's run() on match.
//
// Supports two-chord sequences (e.g. "cmd+k cmd+s") via a small state machine
// with a timeout. When a key is both an exact binding and a chord prefix,
// the prefix wins at runtime (exact binding is shadowed) — the editor surfaces
// this as a warning.

import { useStore } from "../state/store";
import { COMMANDS, getCommand, type Command } from "../commands/registry";
import { keystrokeFromEvent, parseKeystroke } from "./keystroke";

const CHORD_TIMEOUT_MS = 1200;

interface BindingMaps {
  /** First-chord → commandId for one-chord bindings. */
  exact: Map<string, string>;
  /** First-chord → (second-chord → commandId) for two-chord bindings. */
  prefix: Map<string, Map<string, string>>;
}

function buildBindingMaps(overrides: Record<string, string | null> | undefined): BindingMaps {
  const exact = new Map<string, string>();
  const prefix = new Map<string, Map<string, string>>();

  for (const cmd of COMMANDS) {
    const override = overrides?.[cmd.id];
    const stroke = override === undefined ? cmd.defaultKeybinding : override;
    if (!stroke) continue;

    const chords = parseKeystroke(stroke);
    if (chords.length === 0) continue;

    if (chords.length === 1) {
      // Last writer wins — later commands with the same keystroke overwrite earlier ones.
      // The editor should prevent creating this state; defensive fallback only.
      exact.set(chords[0]!, cmd.id);
    } else if (chords.length === 2) {
      let inner = prefix.get(chords[0]!);
      if (!inner) {
        inner = new Map();
        prefix.set(chords[0]!, inner);
      }
      inner.set(chords[1]!, cmd.id);
    }
    // Sequences longer than 2 chords are ignored at runtime.
  }

  return { exact, prefix };
}

let maps: BindingMaps = { exact: new Map(), prefix: new Map() };
let pendingPrefix: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

const pendingListeners = new Set<(prefix: string | null) => void>();

function setPending(next: string | null) {
  if (pendingPrefix === next) return;
  pendingPrefix = next;
  for (const fn of pendingListeners) fn(next);
}

function clearPending() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  setPending(null);
}

/** Subscribe to pending-chord updates. Returns an unsubscribe function. */
export function subscribePendingChord(fn: (prefix: string | null) => void): () => void {
  pendingListeners.add(fn);
  return () => { pendingListeners.delete(fn); };
}

export function getPendingChord(): string | null {
  return pendingPrefix;
}

function dispatchCommand(cmd: Command) {
  try {
    const result = cmd.run();
    if (result instanceof Promise) result.catch((err) => console.error(`[keybindings] ${cmd.id} failed:`, err));
  } catch (err) {
    console.error(`[keybindings] ${cmd.id} threw:`, err);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  const stroke = keystrokeFromEvent(e);
  if (!stroke) return;

  if (pendingPrefix !== null) {
    // Expecting second chord.
    const inner = maps.prefix.get(pendingPrefix);
    const commandId = inner?.get(stroke);
    clearPending();
    if (commandId) {
      const cmd = getCommand(commandId);
      if (cmd) {
        e.preventDefault();
        dispatchCommand(cmd);
      }
    }
    // If no match, state is cleared and the second keystroke is swallowed —
    // mirrors VS Code's "chord aborted" UX. Don't let a stale second key leak
    // through to other handlers.
    return;
  }

  // No pending chord. Prefer chord prefix over exact binding when both exist —
  // otherwise the exact binding would fire and the second chord of the sequence
  // would arrive too late to match.
  if (maps.prefix.has(stroke)) {
    e.preventDefault();
    setPending(stroke);
    pendingTimer = setTimeout(clearPending, CHORD_TIMEOUT_MS);
    return;
  }

  const commandId = maps.exact.get(stroke);
  if (commandId) {
    const cmd = getCommand(commandId);
    if (cmd) {
      e.preventDefault();
      dispatchCommand(cmd);
    }
  }
}

let installed = false;

/** Install the global dispatcher. Idempotent — calling twice is a no-op.
 *  Rebuilds the binding maps whenever `config.keybindings` changes in the store. */
export function installKeybindingDispatcher(): void {
  if (installed) return;
  installed = true;

  const initial = useStore.getState().config?.keybindings;
  maps = buildBindingMaps(initial);

  useStore.subscribe((state, prev) => {
    if (state.config?.keybindings !== prev.config?.keybindings) {
      maps = buildBindingMaps(state.config?.keybindings);
      clearPending();
    }
  });

  window.addEventListener("keydown", handleKeyDown);
}
