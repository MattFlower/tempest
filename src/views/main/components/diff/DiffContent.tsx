// ============================================================
// DiffContent — renders diff using diff2html.
// Port of WebDiffRenderer.swift's HTML template approach.
// Uses diff2html to generate HTML, rendered via dangerouslySetInnerHTML.
// ============================================================

import { useMemo, useRef, useEffect } from "react";
import { html as diff2htmlHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";

interface DiffContentProps {
  rawDiff: string;
  displayMode: "unified" | "side-by-side";
  hunkIndex: number;
}

/**
 * Custom CSS overrides to match Catppuccin dark theme.
 * Mirrors the style from WebDiffRenderer.swift.
 */
const CUSTOM_CSS = `
  .d2h-wrapper {
    background: var(--ctp-base);
  }
  .d2h-file-header {
    display: none;
  }
  .d2h-code-linenumber,
  .d2h-code-side-linenumber {
    background: var(--ctp-base);
    color: var(--ctp-overlay0);
    border-right: 1px solid var(--ctp-surface0);
  }
  .d2h-code-line,
  .d2h-code-side-line {
    background: var(--ctp-base);
    color: var(--ctp-text);
  }
  .d2h-del {
    background-color: rgba(243, 139, 168, 0.12);
    border-color: rgba(243, 139, 168, 0.2);
  }
  .d2h-ins {
    background-color: rgba(166, 227, 161, 0.12);
    border-color: rgba(166, 227, 161, 0.2);
  }
  .d2h-del .d2h-code-side-linenumber,
  .d2h-del .d2h-code-linenumber {
    background-color: rgba(243, 139, 168, 0.12);
  }
  .d2h-ins .d2h-code-side-linenumber,
  .d2h-ins .d2h-code-linenumber {
    background-color: rgba(166, 227, 161, 0.12);
  }
  .d2h-code-line-ctn {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    background: transparent;
  }
  .d2h-info {
    background: var(--ctp-surface0);
    color: var(--ctp-subtext0);
    border-color: var(--ctp-surface0);
  }
  .d2h-file-diff {
    border: none;
  }
  .d2h-diff-table {
    font-size: 12px;
    border-color: var(--ctp-surface0);
  }
  .d2h-diff-table td,
  .d2h-diff-table tr {
    border-color: var(--ctp-surface0);
  }
  .d2h-emptyplaceholder,
  .d2h-emptyplaceholder-code,
  .d2h-emptyplaceholder-linenumber {
    background: var(--ctp-base);
    border-color: var(--ctp-surface0);
  }
  .d2h-file-side-diff {
    background: var(--ctp-base);
    border-color: var(--ctp-surface0);
  }
  .d2h-files-diff {
    border-color: var(--ctp-surface0);
  }
  .d2h-del .d2h-code-line-ctn,
  .d2h-ins .d2h-code-line-ctn {
    color: inherit;
  }
  /* Custom scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: var(--ctp-base);
  }
  ::-webkit-scrollbar-thumb {
    background: var(--ctp-surface1);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--ctp-overlay0);
  }
`;

export function DiffContent({
  rawDiff,
  displayMode,
  hunkIndex,
}: DiffContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevHunkIndex = useRef(hunkIndex);

  // Generate diff HTML
  const diffHtml = useMemo(() => {
    if (!rawDiff.trim()) {
      return '<div style="color: var(--ctp-subtext0); padding: 40px; text-align: center;">No changes</div>';
    }

    return diff2htmlHtml(rawDiff, {
      drawFileList: false,
      matching: "lines",
      outputFormat: displayMode === "side-by-side" ? "side-by-side" : "line-by-line",
      renderNothingWhenEmpty: false,
    });
  }, [rawDiff, displayMode]);

  // Scroll to hunk when hunkIndex changes
  useEffect(() => {
    if (!containerRef.current) return;

    const hunks = containerRef.current.querySelectorAll(".d2h-info");
    if (hunks.length > 0 && hunkIndex < hunks.length) {
      hunks[hunkIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevHunkIndex.current = hunkIndex;
  }, [hunkIndex]);

  // Scroll first change into view on initial load
  useEffect(() => {
    if (!containerRef.current) return;
    const firstChange = containerRef.current.querySelector(".d2h-del, .d2h-ins");
    if (firstChange) {
      firstChange.scrollIntoView({ block: "center" });
    }
  }, [rawDiff, displayMode]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto"
      style={{ background: "var(--ctp-base)" }}
    >
      <style>{CUSTOM_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
    </div>
  );
}
