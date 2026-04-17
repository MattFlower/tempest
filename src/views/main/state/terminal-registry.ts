// Global registry of live TerminalInstance objects, keyed by terminalId.
// Used by the scrollback auto-save to serialize terminal buffers.

import type { TerminalInstance } from "../components/terminal/terminal-instance";

const instances = new Map<string, TerminalInstance>();

export function registerTerminalInstance(id: string, instance: TerminalInstance) {
  instances.set(id, instance);
}

export function unregisterTerminalInstance(id: string) {
  instances.delete(id);
}

export function getTerminalInstance(id: string): TerminalInstance | undefined {
  return instances.get(id);
}

export function getAllTerminalInstances(): Map<string, TerminalInstance> {
  return instances;
}

// Terminal IDs whose owning tab is being moved between panes. The move action
// adds the id BEFORE committing the tree change so that when TerminalPane's
// unmount cleanup runs (possibly in the same event batch as the Zustand
// update), it can distinguish "tab moved" from "tab closed" without racing
// against store state — avoiding a TOCTOU kill of a live PTY.
const movingTerminals = new Set<string>();

export function markTerminalMoving(id: string) {
  movingTerminals.add(id);
}

export function consumeTerminalMoving(id: string): boolean {
  return movingTerminals.delete(id);
}
