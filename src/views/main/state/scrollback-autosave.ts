// Periodically serializes terminal scrollback buffers and sends them
// to the backend for persistence in the session state file.

import { getAllTerminalInstances } from "./terminal-registry";
import { api } from "./rpc-client";

const SCROLLBACK_LINES = 200;
const AUTOSAVE_INTERVAL_MS = 30_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let beforeUnloadListener: (() => void) | null = null;

function sendScrollbackUpdate() {
  const instances = getAllTerminalInstances();
  if (instances.size === 0) return;

  const entries: Array<{ terminalId: string; scrollback: string; cwd?: string }> = [];

  for (const [id, instance] of instances) {
    try {
      const scrollback = instance.serializeScrollback(SCROLLBACK_LINES);
      entries.push({
        terminalId: id,
        scrollback,
        cwd: instance.cwd,
      });
    } catch (e) {
      console.warn(`[scrollback] Failed to serialize terminal ${id}:`, e);
    }
  }

  if (entries.length > 0) {
    api.sendTerminalScrollbackUpdate(entries);
  }
}

export function startScrollbackAutosave() {
  if (intervalId !== null) return;
  intervalId = setInterval(sendScrollbackUpdate, AUTOSAVE_INTERVAL_MS);

  // Flush scrollback before the webview unloads (app quit / reload)
  beforeUnloadListener = () => {
    sendScrollbackUpdate();
  };
  window.addEventListener("beforeunload", beforeUnloadListener);
}

export function stopScrollbackAutosave() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (beforeUnloadListener !== null) {
    window.removeEventListener("beforeunload", beforeUnloadListener);
    beforeUnloadListener = null;
  }
}

/** Flush scrollback immediately (e.g., before app shutdown). */
export function flushScrollbackNow() {
  sendScrollbackUpdate();
}
