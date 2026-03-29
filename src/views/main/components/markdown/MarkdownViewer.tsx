// ============================================================
// MarkdownViewer — Port of MarkdownViewerView.swift
// Renders a markdown file in an iframe with syntax highlighting,
// mermaid diagrams, and live file watching.
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { api, onMarkdownFileChanged, offMarkdownFileChanged } from "../../state/rpc-client";
import { buildMarkdownHTML } from "./markdown-html-builder";

interface MarkdownViewerProps {
  filePath?: string;
}

export function MarkdownViewer({ filePath }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fileChanged, setFileChanged] = useState(false);
  const [fileDeleted, setFileDeleted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentPathRef = useRef<string | undefined>(filePath);

  // Load the file content
  const loadFile = useCallback(async () => {
    if (!filePath) return;
    try {
      const result = await api.readMarkdownFile(filePath);
      setContent(result.content);
      setFileName(result.fileName);
      setError(null);
      setFileDeleted(false);
    } catch (err: any) {
      setError(err?.message ?? "Failed to read file");
      setContent(null);
    }
  }, [filePath]);

  // Initial load + set up file watching
  useEffect(() => {
    if (!filePath) return;
    currentPathRef.current = filePath;

    // Load file
    loadFile();

    // Start watching
    api.watchMarkdownFile(filePath);

    // Listen for push notifications
    onMarkdownFileChanged((changedPath, newContent) => {
      if (changedPath === currentPathRef.current) {
        setContent(newContent);
        setFileChanged(false); // Auto-update since we get the content directly
      }
    });

    return () => {
      // Cleanup: stop watching and unsubscribe
      if (currentPathRef.current) {
        api.unwatchMarkdownFile(currentPathRef.current);
      }
      offMarkdownFileChanged();
    };
  }, [filePath, loadFile]);

  // Build the srcdoc HTML when content changes
  const srcdoc = content !== null ? buildMarkdownHTML(content) : null;

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

      {/* Markdown content iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc ?? ""}
        sandbox="allow-scripts"
        className="flex-1 w-full border-0"
        style={{ backgroundColor: "var(--ctp-base)" }}
        title={`Markdown: ${fileName}`}
      />
    </div>
  );
}
