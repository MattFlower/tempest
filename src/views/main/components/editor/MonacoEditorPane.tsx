// ============================================================
// MonacoEditorPane — renders a file in the Monaco code editor.
// Loads file content via RPC, supports Cmd+S save, and uses
// the Espresso Libre dark theme.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import type { editor, IDisposable } from "monaco-editor";
// monaco-vim is pre-built as a self-contained ESM bundle (src/vendor/monaco-vim.bundle.js)
// that resolves monaco-editor imports from window.monaco at runtime.
// Loaded dynamically via import() to avoid Bun's bundler pulling in monaco-editor ESM.
type VimMode = { dispose(): void };
type VimApi = { Vim: { defineEx: (name: string, shortName: string, fn: (...args: any[]) => void) => void } };
let initVimModeFn: ((ed: editor.IStandaloneCodeEditor, statusBar?: HTMLElement) => VimMode) | null = null;
let vimApi: VimApi | null = null;

const loadMonacoVim = async (): Promise<void> => {
  if (initVimModeFn) return;
  // Fetch the pre-built bundle and evaluate it as a blob URL module.
  // Native import() doesn't work with Electrobun's views:// protocol,
  // so we fetch + create an object URL to load the ESM bundle.
  const resp = await fetch("monaco-vim.bundle.js");
  const text = await resp.text();
  const blob = new Blob([text], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const mod = await import(/* @vite-ignore */ url);
  URL.revokeObjectURL(url);
  initVimModeFn = mod.initVimMode;
  vimApi = mod.VimMode as VimApi;
};
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { PaneTabKind, EditorType } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { addTab } from "../../state/actions";
import { tempestTheme, TEMPEST_THEME_NAME, tempestLightTheme, TEMPEST_LIGHT_THEME_NAME } from "./tempest-theme";
import { ImportLinkProvider, TEMPEST_FILE_SCHEME } from "./import-link-provider";

// Configure Monaco to load from local bundled files
loader.config({ paths: { vs: "./monaco-editor/min/vs" } });

interface MonacoEditorPaneProps {
  filePath: string;
  workspacePath?: string;
  lineNumber?: number;
  isFocused: boolean;
  onCloseRequest?: () => void;
}

function displayPathForHeader(filePath: string, workspacePath?: string): string {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedWorkspacePath = workspacePath?.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedWorkspacePath && normalizedFilePath.startsWith(normalizedWorkspacePath + "/")) {
    return normalizedFilePath.slice(normalizedWorkspacePath.length + 1);
  }

  return normalizedFilePath;
}

export function MonacoEditorPane({
  filePath,
  workspacePath,
  lineNumber,
  isFocused,
  onCloseRequest,
}: MonacoEditorPaneProps) {
  const themeMode = useStore((s) => s.config?.theme ?? "dark");
  const monacoThemeName = themeMode === "light" ? TEMPEST_LIGHT_THEME_NAME : TEMPEST_THEME_NAME;

  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState("plaintext");
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editorReady, setEditorReady] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const currentContentRef = useRef<string>("");
  const themeRegistered = useRef(false);
  const vimModeRef = useRef<VimMode | null>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);
  // Monaco link providers are registered globally; capture their disposables
  // so they don't accumulate across editor mounts (e.g., tab switches / remounts).
  const disposablesRef = useRef<IDisposable[]>([]);

  const vimEnabled = useStore((s) => s.config?.monacoVimMode ?? false);
  const headerPath = useMemo(
    () => displayPathForHeader(filePath, workspacePath),
    [filePath, workspacePath],
  );

  // Load file content on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await api.readFileForEditor(filePath);
        if (!cancelled) {
          setContent(result.content);
          setLanguage(result.language);
          currentContentRef.current = result.content;
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      await api.writeFileForEditor(filePath, currentContentRef.current);
      setIsDirty(false);
    } catch (err: any) {
      console.error("[MonacoEditor] save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [filePath, isDirty, isSaving]);

  // Refs so vim ex-commands and keydown handlers always see the latest
  // callbacks without re-registering effects.
  const onCloseRef = useRef(onCloseRequest);
  onCloseRef.current = onCloseRequest;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // Cmd+S to save, Cmd+W to close tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isFocused || !e.metaKey) return;
      if (e.key === "s") {
        e.preventDefault();
        handleSaveRef.current();
      } else if (e.key === "w") {
        e.preventDefault();
        onCloseRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFocused]);

  // Init/dispose vim mode when the setting changes or editor mounts
  useEffect(() => {
    if (!vimEnabled || !editorReady) return;
    const ed = editorRef.current;
    const bar = statusBarRef.current;
    if (!ed || !bar) return;

    let disposed = false;

    (async () => {
      if (!initVimModeFn) await loadMonacoVim();
      if (disposed || !initVimModeFn) return;
      vimModeRef.current = initVimModeFn(ed, bar);

      // Register :w, :q, :wq
      if (vimApi) {
        const { Vim } = vimApi;
        Vim.defineEx("write", "w", () => {
          handleSaveRef.current();
        });
        Vim.defineEx("quit", "q", () => {
          onCloseRef.current?.();
        });
        Vim.defineEx("wquit", "wq", () => {
          handleSaveRef.current().then(() => onCloseRef.current?.());
        });
      }
    })();

    return () => {
      disposed = true;
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
    };
  }, [vimEnabled, editorReady]);

  // Dispose any Monaco global registrations (e.g. link providers) registered
  // by handleEditorMount when the component unmounts. Idempotent: the array
  // is cleared after disposal so re-mounts start fresh.
  useEffect(() => {
    return () => {
      for (const d of disposablesRef.current) {
        try { d.dispose(); } catch { /* ignore */ }
      }
      disposablesRef.current = [];
    };
  }, []);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setEditorReady(true);

    // Register dark and light themes once
    if (!themeRegistered.current) {
      monaco.editor.defineTheme(TEMPEST_THEME_NAME, tempestTheme);
      monaco.editor.defineTheme(TEMPEST_LIGHT_THEME_NAME, tempestLightTheme);
      themeRegistered.current = true;

      // Disable semantic validation — Monaco's TS service doesn't have access
      // to the project's node_modules or tsconfig, so module resolution errors
      // are all false positives. Syntax validation is kept.
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
      });
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
      });
    }
    const currentTheme = useStore.getState().config?.theme ?? "dark";
    monaco.editor.setTheme(currentTheme === "light" ? TEMPEST_LIGHT_THEME_NAME : TEMPEST_THEME_NAME);

    // Jump to line if specified. Defer one frame so Monaco has done its
    // initial layout pass — otherwise revealLineInCenter centers against a
    // stale viewport height and the target line lands off-screen or at top.
    if (lineNumber) {
      const target = lineNumber;
      editor.setPosition({ lineNumber: target, column: 1 });
      requestAnimationFrame(() => {
        editor.revealLineInCenter(target);
      });
    }

    // Also bind Cmd+S inside Monaco's own keybinding system
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSaveRef.current(),
    );

    // Register import link provider for TS/JS files.
    // registerLinkProvider returns an IDisposable; if we don't dispose it on
    // unmount, every editor mount leaks two global providers that fire for all
    // future editors. Track them in disposablesRef and clean up on unmount.
    const linkProvider = new ImportLinkProvider(filePath);
    disposablesRef.current.push(
      monaco.languages.registerLinkProvider({ language: "typescript" }, linkProvider),
      monaco.languages.registerLinkProvider({ language: "javascript" }, linkProvider),
    );

    // Handle Cmd+click on import specifiers: resolve the module and open it.
    // Monaco's standalone opener ignores custom URI schemes, so we handle
    // clicks directly via onMouseDown instead.
    editor.onMouseDown((e) => {
      if (!e.event.metaKey) return;
      const pos = e.target.position;
      if (!pos) return;

      const model = editor.getModel();
      if (!model) return;

      const lineContent = model.getLineContent(pos.lineNumber);

      // Check if the click is inside an import specifier string
      const patterns = [
        /from\s+(["'])([^"']+)\1/g,
        /require\(\s*(["'])([^"']+)\1\s*\)/g,
        /import\(\s*(["'])([^"']+)\1\s*\)/g,
      ];

      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(lineContent)) !== null) {
          const specifier = match[2];
          if (!specifier) continue;
          const quoteChar = match[1];
          const specStart = lineContent.indexOf(quoteChar + specifier + quoteChar, match.index);
          if (specStart === -1) continue;
          const colStart = specStart + 2; // 1-based + opening quote
          const colEnd = colStart + specifier.length;
          if (pos.column >= colStart && pos.column <= colEnd) {
            // Click is inside this specifier — resolve and open
            api.resolveModulePath(specifier, filePath).then((r: any) => {
              if (!r.resolvedPath) return;
              const label = r.resolvedPath.split("/").pop() ?? "Editor";
              const config = useStore.getState().config;
              const isMonaco = config?.editor === "monaco";
              const { focusedPaneId } = useStore.getState();
              if (focusedPaneId) {
                const tab = createTab(PaneTabKind.Editor, label, {
                  ...(isMonaco ? {} : { terminalId: crypto.randomUUID() }),
                  editorFilePath: r.resolvedPath,
                });
                addTab(focusedPaneId, tab);
              }
            });
            return;
          }
        }
      }
    });

    editor.focus();
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      currentContentRef.current = value;
      setIsDirty(true);
    }
  };

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-red)" }}
      >
        <span className="text-sm">Failed to open file</span>
        <span
          className="text-xs max-w-md text-center"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {error}
        </span>
      </div>
    );
  }

  if (content === null) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading file...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header bar */}
      <div
        className="flex items-center h-8 px-3 text-xs shrink-0 gap-2"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
          color: "var(--ctp-subtext1)",
        }}
      >
        <span className="truncate flex-1" title={filePath}>
          {headerPath}
          {isDirty && (
            <span
              className="ml-1.5 inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--ctp-peach)" }}
              title="Unsaved changes"
            />
          )}
        </span>
        {isSaving && (
          <span style={{ color: "var(--ctp-overlay0)" }}>Saving...</span>
        )}
      </div>

      {/* Monaco editor */}
      <div className="flex-1 min-h-0">
        <Editor
          defaultValue={content}
          language={language}
          theme={monacoThemeName}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            padding: { top: 8 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            automaticLayout: true,
          }}
        />
      </div>

      {/* Vim status bar */}
      {vimEnabled && (
        <div
          ref={statusBarRef}
          className="h-6 px-3 text-xs font-mono flex items-center shrink-0"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            borderTop: "1px solid var(--ctp-surface0)",
            color: "var(--ctp-subtext0)",
          }}
        />
      )}
    </div>
  );
}
