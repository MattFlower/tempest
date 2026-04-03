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
