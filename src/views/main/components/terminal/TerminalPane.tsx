import { useEffect, useRef } from "react";
import { TerminalInstance } from "./terminal-instance";
import { api } from "../../state/rpc-client";
import {
  initTerminalDispatch,
  registerTerminal,
  unregisterTerminal,
} from "../../state/terminal-dispatch";

interface TerminalPaneProps {
  terminalId: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  isFocused: boolean;
  onExit?: (exitCode: number) => void;
}

export function TerminalPane({
  terminalId,
  command,
  cwd,
  env,
  isFocused,
  onExit,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TerminalInstance | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // Capture initial values in refs so useEffect doesn't re-fire on re-renders
  const commandRef = useRef(command);
  const cwdRef = useRef(cwd);
  const envRef = useRef(env);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    initTerminalDispatch();

    const instance = new TerminalInstance(
      terminalId,
      container,
      (data) => api.writeToTerminal(terminalId, data),
      (cols, rows) => {
        api.resizeTerminal({ id: terminalId, cols, rows });
      },
    );
    instanceRef.current = instance;

    const dims = instance.proposeDimensions();

    api.createTerminal({
      id: terminalId,
      command: commandRef.current,
      cwd: cwdRef.current,
      env: envRef.current,
      cols: dims?.cols ?? 80,
      rows: dims?.rows ?? 24,
    }).then((result: any) => {
      if (!result.success) {
        console.error(
          `Failed to create terminal ${terminalId}:`,
          result.error,
        );
        instance.terminal.writeln(
          `\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`,
        );
      }
    });

    registerTerminal(
      terminalId,
      (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        instance.writeBytes(bytes);
      },
      (exitCode) => {
        instance.terminal.writeln(
          `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m`,
        );
        onExitRef.current?.(exitCode);
      },
    );

    return () => {
      unregisterTerminal(terminalId);
      instance.dispose();
      api.killTerminal({ id: terminalId });
    };
    // Only re-create the terminal if the terminalId changes.
    // command/cwd/env are captured at creation time via refs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  useEffect(() => {
    if (isFocused) {
      instanceRef.current?.focus();
    } else {
      instanceRef.current?.blur();
    }
  }, [isFocused]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
    />
  );
}
