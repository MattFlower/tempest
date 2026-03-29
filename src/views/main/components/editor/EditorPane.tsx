// ============================================================
// EditorPane — abstraction for opening files in an editor.
// Resolves the user's configured editor via RPC, then renders
// a TerminalPane with the appropriate command for terminal-based
// editors. Can be extended to support non-terminal editors
// (e.g. a Monaco webview) by adding a renderer branch.
// ============================================================

import { useState, useEffect } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import { TerminalPane } from "../terminal/TerminalPane";
import { api } from "../../state/rpc-client";

interface EditorPaneProps {
  terminalId: string;
  filePath: string;
  lineNumber?: number;
  cwd: string;
  isFocused: boolean;
  onCloseRequest?: () => void;
}

export function EditorPane({
  terminalId,
  filePath,
  lineNumber,
  cwd,
  isFocused,
  onCloseRequest,
}: EditorPaneProps) {
  const [command, setCommand] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await api.buildEditorCommand(filePath, lineNumber);
        if (!cancelled) setCommand(result.command);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, lineNumber]);

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-red)" }}
      >
        <span className="text-sm">Failed to open editor</span>
        <span
          className="text-xs max-w-md text-center"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {error}
        </span>
      </div>
    );
  }

  if (!command) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Opening editor...</span>
      </div>
    );
  }

  return (
    <TerminalPane
      terminalId={terminalId}
      tabKind={PaneTabKind.Editor}
      cwd={cwd}
      initialCommand={command}
      isFocused={isFocused}
      onCloseRequest={onCloseRequest}
    />
  );
}
