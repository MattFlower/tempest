import { useEffect, useRef } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import { TerminalInstance } from "./terminal-instance";
import { api } from "../../state/rpc-client";
import {
  initTerminalDispatch,
  registerTerminal,
  unregisterTerminal,
} from "../../state/terminal-dispatch";
import { consumePendingInput } from "../../state/pending-terminal-input";

interface TerminalPaneProps {
  terminalId: string;
  tabKind: PaneTabKind;
  cwd: string;
  sessionId?: string;
  /** Pre-built command to run. If provided, skips the Claude/Shell command building. */
  initialCommand?: string[];
  resume?: boolean;
  isFocused: boolean;
  onExit?: (exitCode: number) => void;
  onCloseRequest?: () => void;
}

export function TerminalPane({
  terminalId,
  tabKind,
  cwd,
  sessionId,
  initialCommand,
  resume,
  isFocused,
  onExit,
  onCloseRequest,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TerminalInstance | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onCloseRequestRef = useRef(onCloseRequest);
  onCloseRequestRef.current = onCloseRequest;
  const exitedRef = useRef(false);

  // Capture initial values in refs
  const tabKindRef = useRef(tabKind);
  const cwdRef = useRef(cwd);
  const sessionIdRef = useRef(sessionId);
  const initialCommandRef = useRef(initialCommand);
  const resumeRef = useRef(resume);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    exitedRef.current = false;
    initTerminalDispatch();

    const instance = new TerminalInstance(
      terminalId,
      container,
      (data) => {
        if (exitedRef.current) {
          // Any input after exit → close the tab
          onCloseRequestRef.current?.();
          return;
        }
        api.writeToTerminal(terminalId, data);
      },
      (cols, rows) => {
        api.resizeTerminal({ id: terminalId, cols, rows });
      },
    );
    instanceRef.current = instance;

    const dims = instance.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;

    // Build the right command based on tab kind via RPC
    const createTerminalWithCommand = async () => {
      let command: string[];

      if (initialCommandRef.current) {
        // Pre-built command (e.g. from EditorPane)
        command = initialCommandRef.current;
      } else if (tabKindRef.current === PaneTabKind.Claude) {
        try {
          const workspacePath = cwdRef.current;
          const workspaceName = workspacePath.split("/").pop() ?? "default";
          const result = await api.buildClaudeCommand({
            workspacePath,
            resume: resumeRef.current || !!sessionIdRef.current,
            sessionId: sessionIdRef.current,
            withHooks: true,
            workspaceName,
          });
          command = result.command;
        } catch (e) {
          console.error("Failed to build Claude command:", e);
          command = ["/bin/zsh", "-lic", "exec claude"];
        }
      } else {
        try {
          const result = await api.buildShellCommand({
            workspacePath: cwdRef.current,
          });
          command = result.command;
        } catch {
          command = ["/bin/zsh", "-l"];
        }
      }

      const createResult = await api.createTerminal({
        id: terminalId,
        command,
        cwd: cwdRef.current,
        cols,
        rows,
      });

      if (!createResult.success) {
        console.error(
          `Failed to create terminal ${terminalId}:`,
          createResult.error,
        );
        instance.terminal.writeln(
          `\x1b[31mFailed to create terminal: ${createResult.error}\x1b[0m`,
        );
        return;
      }

      // Flush pending input queued by "Ask Claude about selection".
      // Delay lets the CLI process start and be ready for input.
      const pendingInput = consumePendingInput(terminalId);
      if (pendingInput) {
        setTimeout(() => {
          api.writeToTerminal(terminalId, pendingInput);
        }, 2000);
      }
    };

    createTerminalWithCommand();

    registerTerminal(
      terminalId,
      (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        instance.writeBytes(bytes);
      },
      (exitCode) => {
        exitedRef.current = true;
        instance.terminal.writeln(
          `\r\n\x1b[33m[Process exited with code ${exitCode}. Press any key to close.]\x1b[0m`,
        );
        onExitRef.current?.(exitCode);
      },
    );

    return () => {
      unregisterTerminal(terminalId);
      instance.dispose();
      api.killTerminal({ id: terminalId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  useEffect(() => {
    if (isFocused) {
      instanceRef.current?.focus();
    } else {
      instanceRef.current?.blur();
    }
  }, [isFocused]);

  // Re-focus terminal when the window regains focus (e.g. after Cmd+Tab away and back).
  // The isFocused prop doesn't change while the app is backgrounded, so the effect
  // above won't re-fire — we need to listen for the window focus event explicitly.
  useEffect(() => {
    if (!isFocused) return;

    const handleWindowFocus = () => {
      instanceRef.current?.focus();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [isFocused]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
    />
  );
}
