// ============================================================
// EditorPane — abstraction for opening files in an editor.
// Resolves the user's configured editor via RPC, then renders
// a TerminalPane for terminal-based editors (nvim, vim, etc.)
// or a MonacoEditorPane for the Monaco editor.
// ============================================================

import { useState, useEffect } from "react";
import { PaneTabKind, EditorType } from "../../../../shared/ipc-types";
import { TerminalPane } from "../terminal/TerminalPane";
import { MonacoEditorPane } from "./MonacoEditorPane";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";

interface EditorPaneProps {
  terminalId?: string;
  filePath: string;
  lineNumber?: number;
  editorType?: EditorType;
  cwd: string;
  isFocused: boolean;
  onCloseRequest?: () => void;
}

export function EditorPane({
  terminalId,
  filePath,
  lineNumber,
  editorType,
  cwd,
  isFocused,
  onCloseRequest,
}: EditorPaneProps) {
  const config = useStore((s) => s.config);

  // Determine effective editor type: explicit override > config default > neovim
  const effectiveType =
    editorType ?? (config?.editor === "monaco" ? EditorType.Monaco : EditorType.Neovim);

  if (effectiveType === EditorType.Monaco) {
    return (
      <MonacoEditorPane
        filePath={filePath}
        workspacePath={cwd}
        lineNumber={lineNumber}
        isFocused={isFocused}
        onCloseRequest={onCloseRequest}
      />
    );
  }

  // Terminal-based editor (nvim, vim, hx, etc.)
  return (
    <TerminalEditorPane
      terminalId={terminalId!}
      filePath={filePath}
      lineNumber={lineNumber}
      cwd={cwd}
      isFocused={isFocused}
      onCloseRequest={onCloseRequest}
    />
  );
}

// --- Terminal-based editor (extracted from the original EditorPane) ---

function TerminalEditorPane({
  terminalId,
  filePath,
  lineNumber,
  cwd,
  isFocused,
  onCloseRequest,
}: {
  terminalId: string;
  filePath: string;
  lineNumber?: number;
  cwd: string;
  isFocused: boolean;
  onCloseRequest?: () => void;
}) {
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
