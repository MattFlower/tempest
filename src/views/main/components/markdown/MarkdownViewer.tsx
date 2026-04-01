// ============================================================
// MarkdownViewer — Port of MarkdownViewerView.swift
// Renders a markdown file in an iframe with syntax highlighting,
// mermaid diagrams, and live file watching.
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { addTab } from "../../state/actions";
import { api, onMarkdownFileChanged } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { askClaudeAboutSelection } from "../../state/actions";

interface MarkdownViewerProps {
  filePath?: string;
  paneId?: string;
}

export function MarkdownViewer({ filePath, paneId }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fileChanged, setFileChanged] = useState(false);
  const [fileDeleted, setFileDeleted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentPathRef = useRef<string | undefined>(filePath);
  const savedScrollRef = useRef<number>(0);

  // Annotation bridge: stores text selected in the markdown iframe.
  // Will be consumed by a future "ask Claude about this" feature.
  const [annotation, setAnnotation] = useState<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceLine: number | null;
  } | null>(null);

  /** Save the current scroll position from the iframe */
  const saveScrollPosition = useCallback(() => {
    try {
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeWin) {
        savedScrollRef.current = iframeWin.scrollY ?? 0;
      }
    } catch {
      // Cross-origin iframe access may fail in some sandbox configs
    }
  }, []);

  /** Restore saved scroll position in the iframe after it reloads */
  const handleIframeLoad = useCallback(() => {
    const scrollY = savedScrollRef.current;
    if (scrollY > 0) {
      // Delay to let markdown-it render content before scrolling
      setTimeout(() => {
        try {
          iframeRef.current?.contentWindow?.scrollTo(0, scrollY);
        } catch {
          // Ignore cross-origin errors
        }
      }, 100);
    }
  }, []);

  // Load the file content with a timeout to avoid hanging forever
  const loadFile = useCallback(async () => {
    if (!filePath) return;
    saveScrollPosition();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), 5000),
      );
      const result = await Promise.race([
        api.readMarkdownFile(filePath),
        timeout,
      ]);
      setContent(result.content);
      setFileName(result.fileName);
      setError(null);
      setFileDeleted(false);
    } catch (err: any) {
      console.warn("[MarkdownViewer] loadFile failed:", err?.message, "path:", filePath);
      setError(err?.message ?? "Failed to read file");
      setContent(null);
    }
  }, [filePath, saveScrollPosition]);

  // Initial load + set up file watching
  useEffect(() => {
    if (!filePath) return;
    currentPathRef.current = filePath;

    loadFile();

    // Start watching
    api.watchMarkdownFile(filePath);

    // Listen for push notifications
    const unsubscribe = onMarkdownFileChanged((changedPath, newContent, deleted) => {
      if (changedPath === currentPathRef.current) {
        if (deleted) {
          setFileDeleted(true);
          setFileChanged(false);
        } else {
          saveScrollPosition();
          setContent(newContent);
          setFileChanged(false);
        }
      }
    });

    return () => {
      if (currentPathRef.current) {
        api.unwatchMarkdownFile(currentPathRef.current);
      }
      unsubscribe();
    };
  }, [filePath, loadFile]);

  // Listen for annotation (text selection) messages from the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "annotation" && typeof event.data.text === "string") {
        setAnnotation({
          text: event.data.text,
          x: event.data.x,
          y: event.data.y,
          width: event.data.width,
          height: event.data.height,
          sourceLine: event.data.sourceLine ?? null,
        });
      } else if (event.data?.type === "annotation-clear") {
        setAnnotation(null);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleAskClaude = useCallback(() => {
    if (annotation && filePath) {
      askClaudeAboutSelection(annotation.text, filePath, annotation.sourceLine);
      setAnnotation(null);
    }
  }, [annotation, filePath]);

  // content is pre-rendered HTML from the backend
  const srcdoc = content;

  if (!filePath) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">No file selected</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center gap-2"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-lg opacity-40">?</span>
        <span className="text-sm font-medium">Cannot Open File</span>
        <span className="text-xs opacity-60">{error}</span>
      </div>
    );
  }

  if (content === null) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header bar with filename */}
      <div
        className="flex items-center h-8 px-3 text-xs shrink-0"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
          color: "var(--ctp-subtext1)",
        }}
      >
        <span className="truncate" title={filePath}>
          {fileName}
        </span>
        {filePath && (
          <button
            className="ml-auto px-2 py-0.5 rounded text-xs hover:brightness-125"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-subtext1)",
            }}
            onClick={loadFile}
            title="Reload markdown"
          >
            ↻
          </button>
        )}
        {paneId && filePath && (
          <button
            className="ml-2 px-2 py-0.5 rounded text-xs hover:brightness-125"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-subtext1)",
            }}
            onClick={() => {
              const config = useStore.getState().config;
              const isMonaco = config?.editor === "monaco";
              const tab = createTab(PaneTabKind.Editor, fileName, {
                ...(isMonaco ? {} : { terminalId: crypto.randomUUID() }),
                editorFilePath: filePath,
              });
              addTab(paneId, tab);
            }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Notification banners */}
      {fileChanged && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs"
          style={{
            backgroundColor: "color-mix(in srgb, var(--ctp-yellow) 15%, transparent)",
            color: "var(--ctp-text)",
          }}
        >
          <span>File changed on disk</span>
          <button
            className="px-2 py-0.5 rounded text-xs"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
            onClick={() => {
              loadFile();
              setFileChanged(false);
            }}
          >
            Reload
          </button>
          <button
            className="ml-auto text-xs opacity-60 hover:opacity-100"
            onClick={() => setFileChanged(false)}
          >
            x
          </button>
        </div>
      )}
      {fileDeleted && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs"
          style={{
            backgroundColor: "color-mix(in srgb, var(--ctp-red) 15%, transparent)",
            color: "var(--ctp-text)",
          }}
        >
          <span>File no longer exists</span>
          <button
            className="ml-auto text-xs opacity-60 hover:opacity-100"
            onClick={() => setFileDeleted(false)}
          >
            x
          </button>
        </div>
      )}

      {/* Markdown content iframe + Ask Claude tooltip */}
      <div className="relative flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          srcDoc={srcdoc ?? ""}
          sandbox="allow-scripts allow-same-origin"
          className="h-full w-full border-0"
          style={{ backgroundColor: "var(--ctp-base)" }}
          title={`Markdown: ${fileName}`}
          onLoad={handleIframeLoad}
        />
        {annotation && (
          <button
            className="absolute z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium shadow-lg transition-opacity hover:opacity-90"
            style={{
              left: Math.max(8, Math.min(annotation.x + annotation.width / 2 - 40, (iframeRef.current?.clientWidth ?? 300) - 100)),
              top: Math.max(4, annotation.y - 32),
              backgroundColor: "var(--ctp-mauve)",
              color: "var(--ctp-base)",
            }}
            onClick={handleAskClaude}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Ask Claude
          </button>
        )}
      </div>
    </div>
  );
}
