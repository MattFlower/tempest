// ============================================================
// MonacoDiffViewer — Monaco Editor-based diff viewer.
// Supports both unified (inline) and side-by-side diff modes.
// Exposes navigation via forwardRef handle.
// ============================================================

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as monaco from "monaco-editor";

// Configure Monaco workers for browser environment
self.MonacoEnvironment = {
  getWorker(_: string, _label: string) {
    const blob = new Blob(
      ['self.onmessage = function() {}'],
      { type: "text/javascript" },
    );
    return new Worker(URL.createObjectURL(blob));
  },
};

// Catppuccin Mocha theme for Monaco
const CATPPUCCIN_THEME: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6c7086", fontStyle: "italic" },
    { token: "keyword", foreground: "cba6f7" },
    { token: "string", foreground: "a6e3a1" },
    { token: "number", foreground: "fab387" },
    { token: "type", foreground: "f9e2af" },
    { token: "function", foreground: "89b4fa" },
    { token: "variable", foreground: "cdd6f4" },
    { token: "operator", foreground: "89dceb" },
  ],
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editor.lineHighlightBackground": "#313244",
    "editor.selectionBackground": "#585b7044",
    "editorLineNumber.foreground": "#6c7086",
    "editorLineNumber.activeForeground": "#cdd6f4",
    "editor.inactiveSelectionBackground": "#45475a44",
    "editorWidget.background": "#181825",
    "editorWidget.border": "#313244",
    "diffEditor.insertedTextBackground": "#a6e3a120",
    "diffEditor.removedTextBackground": "#f38ba820",
    "diffEditor.insertedLineBackground": "#a6e3a110",
    "diffEditor.removedLineBackground": "#f38ba810",
  },
};

let themeRegistered = false;
let modelCounter = 0;

// --- Public handle for navigation ---

export interface MonacoDiffViewerHandle {
  goToNextDiff: () => void;
  goToPrevDiff: () => void;
}

interface MonacoDiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  language: string;
  filePath: string;
  displayMode: "unified" | "side-by-side";
}

export const MonacoDiffViewer = forwardRef<
  MonacoDiffViewerHandle,
  MonacoDiffViewerProps
>(function MonacoDiffViewer(
  { originalContent, modifiedContent, language, filePath, displayMode },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  // Register theme once
  if (!themeRegistered) {
    monaco.editor.defineTheme("catppuccin-mocha", CATPPUCCIN_THEME);
    themeRegistered = true;
  }

  // Expose navigation methods
  useImperativeHandle(ref, () => ({
    goToNextDiff: () => {
      const editor = editorRef.current;
      if (!editor) return;
      const changes = editor.getLineChanges();
      if (!changes || changes.length === 0) return;

      const modEditor = editor.getModifiedEditor();
      const currentLine = modEditor.getPosition()?.lineNumber ?? 0;

      // Find next change after current line
      for (const change of changes) {
        const line = change.modifiedStartLineNumber;
        if (line > currentLine) {
          modEditor.revealLineInCenter(line);
          modEditor.setPosition({ lineNumber: line, column: 1 });
          return;
        }
      }
      // Wrap to first change
      const firstLine = changes[0]!.modifiedStartLineNumber;
      modEditor.revealLineInCenter(firstLine);
      modEditor.setPosition({ lineNumber: firstLine, column: 1 });
    },
    goToPrevDiff: () => {
      const editor = editorRef.current;
      if (!editor) return;
      const changes = editor.getLineChanges();
      if (!changes || changes.length === 0) return;

      const modEditor = editor.getModifiedEditor();
      const currentLine = modEditor.getPosition()?.lineNumber ?? Infinity;

      // Find previous change before current line
      for (let i = changes.length - 1; i >= 0; i--) {
        const line = changes[i]!.modifiedStartLineNumber;
        if (line < currentLine) {
          modEditor.revealLineInCenter(line);
          modEditor.setPosition({ lineNumber: line, column: 1 });
          return;
        }
      }
      // Wrap to last change
      const lastLine =
        changes[changes.length - 1]!.modifiedStartLineNumber;
      modEditor.revealLineInCenter(lastLine);
      modEditor.setPosition({ lineNumber: lastLine, column: 1 });
    },
  }));

  // Single effect: create editor + set models. Re-runs on any prop change.
  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose previous editor
    if (editorRef.current) {
      editorRef.current.dispose();
      editorRef.current = null;
    }

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: "catppuccin-mocha",
      readOnly: true,
      renderSideBySide: displayMode === "side-by-side",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineHeight: 18,
      renderOverviewRuler: false,
      padding: { top: 8 },
      diffWordWrap: "on",
      ignoreTrimWhitespace: false,
    });

    editorRef.current = editor;

    // Create models with unique URIs to avoid conflicts
    const id = ++modelCounter;
    const originalModel = monaco.editor.createModel(
      originalContent,
      language,
      monaco.Uri.parse(`inmemory://diff-original/${id}/${filePath}`),
    );
    const modifiedModel = monaco.editor.createModel(
      modifiedContent,
      language,
      monaco.Uri.parse(`inmemory://diff-modified/${id}/${filePath}`),
    );

    editor.setModel({ original: originalModel, modified: modifiedModel });

    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = null;
    };
  }, [originalContent, modifiedContent, language, filePath, displayMode]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: "#1e1e2e" }}
    />
  );
});

// --- Header bar for the diff viewer ---

interface VCSDiffHeaderProps {
  filePath: string | null;
  displayMode: "unified" | "side-by-side";
  onDisplayModeChange: (mode: "unified" | "side-by-side") => void;
  staged?: boolean;
  onNextDiff?: () => void;
  onPrevDiff?: () => void;
}

export function VCSDiffHeader({
  filePath,
  displayMode,
  onDisplayModeChange,
  staged,
  onNextDiff,
  onPrevDiff,
}: VCSDiffHeaderProps) {
  if (!filePath) return null;

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs truncate" style={{ color: "var(--ctp-text)" }}>
          {filePath}
        </span>
        {staged !== undefined && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              backgroundColor: staged ? "var(--ctp-green)" : "var(--ctp-blue)",
              color: "var(--ctp-base)",
            }}
          >
            {staged ? "Staged" : "Unstaged"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Diff navigation buttons */}
        {onPrevDiff && (
          <button
            onClick={onPrevDiff}
            className="px-1.5 py-1 text-[10px] rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
            title="Previous change"
          >
            &#x25B2;
          </button>
        )}
        {onNextDiff && (
          <button
            onClick={onNextDiff}
            className="px-1.5 py-1 text-[10px] rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
            title="Next change"
          >
            &#x25BC;
          </button>
        )}

        {(onPrevDiff || onNextDiff) && (
          <div
            className="mx-1"
            style={{
              width: 1,
              height: 16,
              backgroundColor: "var(--ctp-surface1)",
            }}
          />
        )}

        {/* Display mode toggle */}
        <button
          onClick={() => onDisplayModeChange("unified")}
          className="px-2 py-1 text-[10px] rounded transition-colors"
          style={{
            backgroundColor:
              displayMode === "unified" ? "var(--ctp-surface1)" : "transparent",
            color: "var(--ctp-text)",
          }}
        >
          Unified
        </button>
        <button
          onClick={() => onDisplayModeChange("side-by-side")}
          className="px-2 py-1 text-[10px] rounded transition-colors"
          style={{
            backgroundColor:
              displayMode === "side-by-side"
                ? "var(--ctp-surface1)"
                : "transparent",
            color: "var(--ctp-text)",
          }}
        >
          Side by Side
        </button>
      </div>
    </div>
  );
}
