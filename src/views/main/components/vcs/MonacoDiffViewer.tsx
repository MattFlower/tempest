// ============================================================
// MonacoDiffViewer — Monaco Editor-based diff viewer.
// Uses @monaco-editor/react DiffEditor with AMD-loaded Monaco
// for proper worker support (diff computation, syntax highlighting).
// Supports both unified (inline) and side-by-side diff modes.
// Exposes navigation via forwardRef handle.
// ============================================================

import { useRef, forwardRef, useImperativeHandle, useCallback, useEffect } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { tempestTheme, TEMPEST_THEME_NAME, tempestLightTheme, TEMPEST_LIGHT_THEME_NAME } from "../editor/tempest-theme";
import { useStore } from "../../state/store";

// Selection info exposed to parent for "Ask Claude" button positioning
export interface MonacoSelection {
  text: string;
  lineNumber: number;
  x: number;
  y: number;
}

// Configure Monaco to load from local bundled files (same as MonacoEditorPane)
loader.config({ paths: { vs: "./monaco-editor/min/vs" } });

let themeRegistered = false;

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
  onTextSelection?: (sel: MonacoSelection | null) => void;
}

export const MonacoDiffViewer = forwardRef<
  MonacoDiffViewerHandle,
  MonacoDiffViewerProps
>(function MonacoDiffViewer(
  { originalContent, modifiedContent, language, filePath, displayMode, onTextSelection },
  ref,
) {
  const themeMode = useStore((s) => s.config?.theme ?? "dark");
  const monacoThemeName = themeMode === "light" ? TEMPEST_LIGHT_THEME_NAME : TEMPEST_THEME_NAME;

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const onTextSelectionRef = useRef(onTextSelection);
  onTextSelectionRef.current = onTextSelection;

  // Expose navigation methods
  useImperativeHandle(ref, () => ({
    goToNextDiff: () => {
      const ed = editorRef.current;
      if (!ed) return;
      const changes = ed.getLineChanges();
      if (!changes || changes.length === 0) return;

      const modEditor = ed.getModifiedEditor();
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
      const ed = editorRef.current;
      if (!ed) return;
      const changes = ed.getLineChanges();
      if (!changes || changes.length === 0) return;

      const modEditor = ed.getModifiedEditor();
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

  const handleBeforeMount = useCallback((monaco: any) => {
    if (!themeRegistered) {
      monaco.editor.defineTheme(TEMPEST_THEME_NAME, tempestTheme);
      monaco.editor.defineTheme(TEMPEST_LIGHT_THEME_NAME, tempestLightTheme);
      themeRegistered = true;
    }
  }, []);

  const handleMount = useCallback((diffEditor: editor.IStandaloneDiffEditor) => {
    editorRef.current = diffEditor;

    // Track text selection on the modified (new) editor for "Ask Claude"
    const modEditor = diffEditor.getModifiedEditor();
    modEditor.onDidChangeCursorSelection(() => {
      const cb = onTextSelectionRef.current;
      if (!cb) return;

      const selection = modEditor.getSelection();
      if (!selection || selection.isEmpty()) {
        cb(null);
        return;
      }

      const model = modEditor.getModel();
      if (!model) { cb(null); return; }

      const text = model.getValueInRange(selection);
      if (!text.trim()) { cb(null); return; }

      // Get pixel position relative to editor DOM for button placement
      const startPos = selection.getStartPosition();
      const scrolledPos = modEditor.getScrolledVisiblePosition(startPos);
      const editorDom = modEditor.getDomNode();
      if (!scrolledPos || !editorDom) { cb(null); return; }

      const editorRect = editorDom.getBoundingClientRect();

      cb({
        text,
        lineNumber: startPos.lineNumber,
        x: editorRect.left + scrolledPos.left,
        y: editorRect.top + scrolledPos.top,
      });
    });
  }, []);

  return (
    <DiffEditor
      key={filePath}
      original={originalContent}
      modified={modifiedContent}
      language={language}
      theme={monacoThemeName}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly: true,
        renderSideBySide: displayMode === "side-by-side",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        lineHeight: 18,
        renderOverviewRuler: false,
        padding: { top: 8 },
        diffWordWrap: "on",
        ignoreTrimWhitespace: false,
      }}
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
