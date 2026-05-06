import { useEffect, useRef } from "react";
import { TerminalInstance } from "../terminal/terminal-instance";
import { api } from "../../state/rpc-client";
import {
  initTerminalDispatch,
  registerTerminal,
  unregisterTerminal,
} from "../../state/terminal-dispatch";
import {
  registerTerminalInstance,
  unregisterTerminalInstance,
} from "../../state/terminal-registry";
import { markRunTabExited } from "../../state/run-pane-actions";
import type { RunTab } from "../../models/run-tab";

interface RunPaneTerminalProps {
  workspacePath: string;
  tab: RunTab;
  isActive: boolean;
}

export function RunPaneTerminal({ workspacePath, tab, isActive }: RunPaneTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TerminalInstance | null>(null);
  const exitedRef = useRef(false);

  const commandRef = useRef(tab.command);
  const cwdRef = useRef(tab.cwd);
  const envRef = useRef(tab.env);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    exitedRef.current = false;
    initTerminalDispatch();

    const terminalId = tab.terminalId;
    const tabId = tab.id;

    const instance = new TerminalInstance(
      terminalId,
      container,
      (data) => {
        if (exitedRef.current) return;
        api.writeToTerminal(terminalId, data);
      },
      (cols, rows) => {
        api.resizeTerminal({ id: terminalId, cols, rows });
      },
    );
    instanceRef.current = instance;
    registerTerminalInstance(terminalId, instance);

    const dims = instance.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;

    const start = async () => {
      try {
        const result = await api.createTerminal({
          id: terminalId,
          command: commandRef.current,
          cwd: cwdRef.current,
          env: envRef.current,
          cols,
          rows,
        });
        if (!result.success) {
          instance.terminal.writeln(
            `\x1b[31mFailed to start script: ${result.error ?? "unknown error"}\x1b[0m`,
          );
          markRunTabExited(workspacePath, tabId, -1);
        }
      } catch (e) {
        instance.terminal.writeln(`\x1b[31mFailed to start script: ${String(e)}\x1b[0m`);
        markRunTabExited(workspacePath, tabId, -1);
      }
    };
    start();

    registerTerminal(
      terminalId,
      (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        instance.writeBytes(bytes);
      },
      (exitCode) => {
        exitedRef.current = true;
        instance.terminal.writeln(
          `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m`,
        );
        markRunTabExited(workspacePath, tabId, exitCode);
      },
    );

    return () => {
      unregisterTerminal(terminalId);
      unregisterTerminalInstance(terminalId);
      instance.dispose();
      // Unmount always means this PTY is being discarded (tab closed or
      // restarted via a fresh terminalId). Run-pane terminals are not moved
      // between panes, so we can unconditionally kill.
      api.killTerminal({ id: terminalId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.terminalId]);

  useEffect(() => {
    instanceRef.current?.setWebglEnabled(isActive);
  }, [isActive, tab.terminalId]);

  useEffect(() => {
    if (isActive) {
      instanceRef.current?.focus();
    } else {
      instanceRef.current?.blur();
    }
  }, [isActive]);

  return (
    <div
      className={`absolute inset-0 ${isActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
