import { useEffect, useRef, useState, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import { TerminalInstance } from "./terminal-instance";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { api } from "../../state/rpc-client";
import {
  initTerminalDispatch,
  registerTerminal,
  unregisterTerminal,
} from "../../state/terminal-dispatch";
import {
  registerTerminalInstance,
  unregisterTerminalInstance,
  consumeTerminalMoving,
} from "../../state/terminal-registry";
import { consumePendingInput } from "../../state/pending-terminal-input";
import { updateTabLabelByTerminalId, updateTabProgressByTerminalId, updateTabCwdByTerminalId } from "../../state/actions";
import { useStore } from "../../state/store";

interface TerminalPaneProps {
  terminalId: string;
  tabKind: PaneTabKind;
  cwd: string;
  sessionId?: string;
  /** Pre-built command to run. If provided, skips the Claude/Shell command building. */
  initialCommand?: string[];
  resume?: boolean;
  isFocused: boolean;
  isVisible: boolean;
  onExit?: (exitCode: number) => void;
  onCloseRequest?: () => void;
  /** Saved scrollback content to restore on startup. */
  scrollbackContent?: string;
}

export function TerminalPane({
  terminalId,
  tabKind,
  cwd,
  sessionId,
  initialCommand,
  resume,
  isFocused,
  isVisible,
  onExit,
  onCloseRequest,
  scrollbackContent,
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
  const scrollbackContentRef = useRef(scrollbackContent);

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
    registerTerminalInstance(terminalId, instance);

    // Wire OSC 7 CWD tracking → update store
    instance.onCwdChange = (newCwd) => {
      updateTabCwdByTerminalId(terminalId, newCwd);
    };

    // Restore saved scrollback before PTY starts
    const savedScrollback = scrollbackContentRef.current;
    if (savedScrollback) {
      instance.terminal.write(savedScrollback);
      instance.terminal.write(
        "\r\n\x1b[90m--- previous session restored ---\x1b[0m\r\n\r\n",
      );
      scrollbackContentRef.current = undefined;
    }

    const dims = instance.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;

    // Build the right command based on tab kind via RPC
    const createTerminalWithCommand = async () => {
      let command: string[];
      // Consume pending HTTP data (prompt + planMode) early so we can
      // pass planMode into the Claude command before the terminal starts.
      let pendingPrompt: string | null = null;
      let pendingPlanMode: boolean | null = null;
      if (tabKindRef.current === PaneTabKind.Claude) {
        try {
          const pending = await api.consumePendingPrompt(cwdRef.current);
          pendingPrompt = pending.prompt;
          pendingPlanMode = pending.planMode;
        } catch {
          // Non-critical — ignore if RPC fails
        }
      }

      if (initialCommandRef.current) {
        // Pre-built command (e.g. from EditorPane)
        command = initialCommandRef.current;
      } else if (tabKindRef.current === PaneTabKind.Claude) {
        try {
          const workspacePath = cwdRef.current;
          const workspaceName = workspacePath.split("/").pop() ?? "default";
          // Each tool defaults to enabled when the config field is undefined,
          // so an older config file (pre-markdown/mermaid toggles) keeps
          // working unchanged. --mcp-config is only passed to claude when at
          // least one tool is enabled; otherwise there's nothing to serve.
          const mcpTools = useStore.getState().config?.mcpTools;
          const mcpEnabled =
            mcpTools?.showWebpage !== false
            || mcpTools?.showMermaidDiagram !== false
            || mcpTools?.showMarkdown !== false;
          const result = await api.buildClaudeCommand({
            workspacePath,
            resume: resumeRef.current || !!sessionIdRef.current,
            sessionId: sessionIdRef.current,
            withHooks: true,
            withMcp: mcpEnabled,
            workspaceName,
            planMode: pendingPlanMode ?? undefined,
          });
          command = result.command;
        } catch (e) {
          console.error("Failed to build Claude command:", e);
          command = ["/bin/zsh", "-lic", "exec claude"];
        }
      } else if (tabKindRef.current === PaneTabKind.Pi) {
        try {
          const result = await api.buildPiCommand({
            workspacePath: cwdRef.current,
            sessionPath: sessionIdRef.current,
            resume: resumeRef.current,
          });
          command = result.command;
        } catch (e) {
          console.error("Failed to build Pi command:", e);
          command = ["/bin/zsh", "-lic", "exec pi"];
        }
      } else if (tabKindRef.current === PaneTabKind.Codex) {
        try {
          const result = await api.buildCodexCommand({
            workspacePath: cwdRef.current,
            sessionId: sessionIdRef.current,
            resume: resumeRef.current,
          });
          command = result.command;
        } catch (e) {
          console.error("Failed to build Codex command:", e);
          command = ["/bin/zsh", "-lic", "exec codex"];
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
        if (createResult.error?.includes("already exists")) {
          // Terminal was moved between panes — PTY is still alive.
          // Resize to match the new pane dimensions.
          api.resizeTerminal({ id: terminalId, cols, rows });
          return;
        }
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

      // Send the pending prompt from the HTTP remote control server.
      // Needs a longer delay since Claude Code takes several seconds to start.
      if (pendingPrompt) {
        setTimeout(() => {
          api.writeToTerminal(terminalId, pendingPrompt + "\r");
        }, 5000);
      }
    };

    createTerminalWithCommand();

    instance.terminal.onTitleChange((title) => {
      updateTabLabelByTerminalId(terminalId, title);
    });

    instance.progressAddon.onChange(({ state, value }) => {
      updateTabProgressByTerminalId(terminalId, state, value);
    });

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
      unregisterTerminalInstance(terminalId);
      instance.dispose();

      // Only kill the PTY if the tab was actually closed, not moved to another
      // pane. The move action sets an explicit flag before committing the tree
      // change; checking a flag (rather than scanning the Zustand tree) avoids
      // a TOCTOU race when unmount runs in the same event batch as the store
      // update and would otherwise see the stale pre-move tree.
      if (consumeTerminalMoving(terminalId)) return;

      api.killTerminal({ id: terminalId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  const [searchVisible, setSearchVisible] = useState(false);

  useEffect(() => {
    instanceRef.current?.setWebglEnabled(isVisible);
  }, [isVisible]);

  useEffect(() => {
    if (isFocused && isVisible && !searchVisible) {
      instanceRef.current?.focus();
    } else if (!isFocused || !isVisible) {
      instanceRef.current?.blur();
    }
  }, [isFocused, isVisible, searchVisible]);

  // Re-focus terminal when the window regains focus (e.g. after Cmd+Tab away and back).
  useEffect(() => {
    if (!isFocused || !isVisible) return;

    const handleWindowFocus = () => {
      if (!searchVisible) {
        instanceRef.current?.focus();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [isFocused, isVisible, searchVisible]);

  // Cmd+F to open terminal search
  useEffect(() => {
    if (!isFocused || !isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocused, isVisible]);

  const handleSearchClose = useCallback(() => {
    setSearchVisible(false);
  }, []);

  // Accept file drops from the sidebar's file tree: insert the shell-quoted
  // absolute path at the PTY's current cursor. Uses the plain-text type
  // (set by FileTreeView's drag handler) so we don't reach across into
  // sidebar-specific MIME code from here.
  const handleTerminalDragOver = useCallback((e: React.DragEvent) => {
    if (!useStore.getState().isFileTreeDragActive) return;
    if (!e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleTerminalDrop = useCallback((e: React.DragEvent) => {
    if (!useStore.getState().isFileTreeDragActive) return;
    const path = e.dataTransfer.getData("text/plain");
    if (!path) return;
    e.preventDefault();
    useStore.getState().setFileTreeDragActive(false);
    // Shell-safe single-quoted path: close-quote, escaped-quote, reopen.
    const quoted = `'${path.replace(/'/g, "'\\''")}' `;
    api.writeToTerminal(terminalId, quoted);
  }, [terminalId]);

  return (
    <div
      className="relative h-full w-full"
      onDragOver={handleTerminalDragOver}
      onDrop={handleTerminalDrop}
    >
      {searchVisible && instanceRef.current && (
        <TerminalSearchBar
          instance={instanceRef.current}
          onClose={handleSearchClose}
        />
      )}
      <div
        ref={containerRef}
        className="h-full w-full"
      />
    </div>
  );
}
