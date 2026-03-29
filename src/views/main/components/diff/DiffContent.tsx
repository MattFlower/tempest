// ============================================================
// DiffContent — renders diff using diff2html.
// Port of WebDiffRenderer.swift's HTML template approach.
// Uses diff2html to generate HTML, rendered via dangerouslySetInnerHTML.
// ============================================================

import { useMemo, useRef, useEffect, useCallback } from "react";
import { html as diff2htmlHtml } from "diff2html";
import hljs from "highlight.js";
import "diff2html/bundles/css/diff2html.min.css";
import "highlight.js/styles/github-dark.css";

/** Map file extensions to highlight.js language names. */
const LANG_MAP: Record<string, string> = {
  swift: "swift", js: "javascript", ts: "typescript",
  tsx: "typescript", jsx: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", css: "css", html: "xml",
  xml: "xml", json: "json", yaml: "yaml", yml: "yaml",
  md: "markdown", sh: "bash", zsh: "bash", sql: "sql",
  c: "c", cpp: "cpp", h: "c", m: "objectivec",
};

/** Extract file extension from a diff header line like "diff --git a/foo.ts b/foo.ts". */
function detectLanguage(rawDiff: string): string {
  const match = rawDiff.match(/diff --git a\/\S+\.(\w+) b\//);
  if (match) {
    return LANG_MAP[match[1]!.toLowerCase()] ?? "";
  }
  return "";
}

interface DiffContentProps {
  rawDiff: string;
  displayMode: "unified" | "side-by-side";
  hunkIndex: number;
  filePath?: string;
  onContextMenuLine?: (lineNumber: number | null, filePath: string, x: number, y: number) => void;
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
  filePath,
  onContextMenuLine,
}: DiffContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevHunkIndex = useRef(hunkIndex);

  // Detect language from file path or diff header
  const lang = useMemo(() => {
    if (filePath) {
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      if (LANG_MAP[ext]) return LANG_MAP[ext]!;
    }
    return detectLanguage(rawDiff);
  }, [filePath, rawDiff]);

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

  // Apply syntax highlighting after diff HTML is rendered
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.querySelectorAll(".d2h-code-line-ctn").forEach((el) => {
      const text = el.textContent;
      if (!text || !text.trim()) return;
      try {
        const result = lang
          ? hljs.highlight(text, { language: lang, ignoreIllegals: true })
          : hljs.highlightAuto(text);
        el.innerHTML = result.value;
      } catch {
        // Leave unhighlighted on error
      }
    });
  }, [diffHtml, lang]);

  // Right-click context menu — extract new-file line number from diff2html DOM
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onContextMenuLine || !filePath) return;
      e.preventDefault();
      let lineNum: number | null = null;
      const tr = (e.target as HTMLElement).closest("tr");
      if (tr) {
        // Side-by-side mode: each side is a separate table inside .d2h-file-side-diff
        const sideCell = tr.querySelector(".d2h-code-side-linenumber");
        if (sideCell) {
          const sideContainer = tr.closest(".d2h-file-side-diff");
          const wrapper = sideContainer?.closest(".d2h-files-diff");
          if (wrapper) {
            const sides = wrapper.querySelectorAll(".d2h-file-side-diff");
            const isRightSide = sides.length >= 2 && sideContainer === sides[1];
            if (isRightSide) {
              const num = parseInt(sideCell.textContent?.trim() ?? "", 10);
              if (!isNaN(num)) lineNum = num;
            } else {
              // On old-file side — look up corresponding row on new-file side
              const rightTable = sides[1]?.querySelector("tbody");
              const leftTable = sides[0]?.querySelector("tbody");
              if (leftTable && rightTable) {
                const idx = Array.from(leftTable.children).indexOf(tr);
                if (idx >= 0 && rightTable.children[idx]) {
                  const rightCell = rightTable.children[idx]!.querySelector(
                    ".d2h-code-side-linenumber",
                  );
                  if (rightCell) {
                    const num = parseInt(rightCell.textContent?.trim() ?? "", 10);
                    if (!isNaN(num)) lineNum = num;
                  }
                }
              }
            }
          }
        }
        // Unified mode: line number cell contains div.line-num2 for new-file number
        if (lineNum === null) {
          const lineNumCell = tr.querySelector(".d2h-code-linenumber");
          if (lineNumCell) {
            const newNumDiv = lineNumCell.querySelector(".line-num2");
            if (newNumDiv) {
              const num = parseInt(newNumDiv.textContent?.trim() ?? "", 10);
              if (!isNaN(num)) lineNum = num;
            }
          }
        }
      }
      onContextMenuLine(lineNum, filePath, e.clientX, e.clientY);
    },
    [onContextMenuLine, filePath],
  );

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
      onContextMenu={handleContextMenu}
      style={{ background: "var(--ctp-base)" }}
    >
      <style>{CUSTOM_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
    </div>
  );
}
