// ============================================================
// JJRestoreFromDialog — modal dialog for restoring a file in
// the target revision from a selected source revision.
// Two-panel layout: revision picker on left, diff preview on right.
// Resizable by dragging edges and corner.
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  JJRevision,
  JJBookmark,
  VCSFileDiffResult,
} from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { MonacoDiffViewer } from "./MonacoDiffViewer";

interface JJRestoreFromDialogProps {
  workspacePath: string;
  targetRevision: string;
  filePath: string;
  revisions: JJRevision[];
  bookmarks: JJBookmark[];
  onConfirm: (sourceRevision: string) => void;
  onCancel: () => void;
}

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

export function JJRestoreFromDialog({
  workspacePath,
  targetRevision,
  filePath,
  revisions,
  bookmarks,
  onConfirm,
  onCancel,
}: JJRestoreFromDialogProps) {
  const [sourceRevision, setSourceRevision] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [previewData, setPreviewData] = useState<VCSFileDiffResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [displayMode, setDisplayMode] = useState<"unified" | "side-by-side">("side-by-side");
  const [dialogWidth, setDialogWidth] = useState(900);
  const [dialogHeight, setDialogHeight] = useState(600);
  const filterRef = useRef<HTMLInputElement>(null);
  const isResizingRef = useRef(false);
  const diffPanelRef = useRef<HTMLDivElement>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(0);

  useEffect(() => {
    filterRef.current?.focus();
  }, []);

  // Track actual rendered width of the diff panel
  useEffect(() => {
    const el = diffPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDiffPanelWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Load preview when source revision changes
  useEffect(() => {
    if (!sourceRevision) {
      setPreviewData(null);
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);

    (async () => {
      try {
        const data = await api.jjGetRestorePreview(
          workspacePath,
          targetRevision,
          sourceRevision,
          filePath,
        );
        if (!cancelled) {
          setPreviewData(data);
        }
      } catch {
        if (!cancelled) {
          setPreviewData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceRevision, workspacePath, targetRevision, filePath]);

  const handleSubmit = useCallback(() => {
    if (!sourceRevision) return;
    onConfirm(sourceRevision);
  }, [sourceRevision, onConfirm]);

  // --- Resize handlers ---

  const finishResize = useCallback(() => {
    // Keep flag raised briefly so the click event from mouseup doesn't close the dialog
    setTimeout(() => { isResizingRef.current = false; }, 0);
  }, []);

  const handleResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startX = e.clientX;
      const startW = dialogWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) * 2;
        setDialogWidth(Math.max(MIN_WIDTH, startW + delta));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        finishResize();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dialogWidth, finishResize],
  );

  const handleResizeBottom = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startY = e.clientY;
      const startH = dialogHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY) * 2;
        setDialogHeight(Math.max(MIN_HEIGHT, startH + delta));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        finishResize();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dialogHeight, finishResize],
  );

  const handleResizeCorner = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = dialogWidth;
      const startH = dialogHeight;
      const onMove = (ev: MouseEvent) => {
        setDialogWidth(Math.max(MIN_WIDTH, startW + (ev.clientX - startX) * 2));
        setDialogHeight(Math.max(MIN_HEIGHT, startH + (ev.clientY - startY) * 2));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        finishResize();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dialogWidth, dialogHeight],
  );

  // Build list of candidate revisions (exclude target)
  const candidates: { changeId: string; description: string; author: string; timestamp: string; bookmarks: string[] }[] = [];
  for (const rev of revisions) {
    if (rev.changeId === targetRevision) continue;
    candidates.push({
      changeId: rev.changeId,
      description: rev.description,
      author: rev.author,
      timestamp: rev.timestamp,
      bookmarks: rev.bookmarks,
    });
  }

  // Filter candidates
  const filtered = filter.trim()
    ? candidates.filter((c) => {
        const q = filter.toLowerCase();
        return (
          c.changeId.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.bookmarks.some((b) => b.toLowerCase().includes(q))
        );
      })
    : candidates;

  const fileName = filePath.split("/").pop() ?? filePath;
  // Monaco's renderSideBySideInlineBreakpoint defaults to 900px — below this it falls back to unified
  const sideBySideTooNarrow = displayMode === "side-by-side" && diffPanelWidth > 0 && diffPanelWidth < 900;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isResizingRef.current) onCancel();
      }}
    >
      <div
        className="rounded-xl shadow-2xl overflow-hidden flex flex-col relative"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface1)",
          width: Math.min(dialogWidth, window.innerWidth * 0.95),
          height: Math.min(dialogHeight, window.innerHeight * 0.9),
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
        >
          <div className="text-sm font-medium" style={{ color: "var(--ctp-text)" }}>
            Restore From...
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--ctp-overlay0)" }}>
            Restore{" "}
            <span className="font-mono font-bold" style={{ color: "var(--ctp-blue)" }}>
              {fileName}
            </span>{" "}
            in revision{" "}
            <span className="font-mono font-bold" style={{ color: "var(--ctp-mauve)" }}>
              {targetRevision}
            </span>{" "}
            from another revision
          </div>
        </div>

        {/* Body — two-panel layout */}
        <div className="flex-1 min-h-0 flex">
          {/* Left panel — revision picker */}
          <div
            className="flex flex-col flex-shrink-0"
            style={{
              width: 300,
              borderRight: "1px solid var(--ctp-surface0)",
            }}
          >
            {/* Filter input */}
            <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--ctp-surface0)" }}>
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter revisions..."
                className="w-full text-xs px-2.5 py-1.5 rounded outline-none font-mono"
                style={{
                  backgroundColor: "var(--ctp-mantle)",
                  color: "var(--ctp-text)",
                  border: "1px solid var(--ctp-surface1)",
                }}
              />
            </div>

            {/* Revision list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filtered.length === 0 ? (
                <div
                  className="px-3 py-4 text-[10px] text-center"
                  style={{ color: "var(--ctp-overlay0)" }}
                >
                  No matching revisions
                </div>
              ) : (
                filtered.map((c) => {
                  const isSelected = sourceRevision === c.changeId;
                  return (
                    <button
                      key={c.changeId}
                      className="w-full text-left px-3 py-2 transition-colors"
                      style={{
                        backgroundColor: isSelected
                          ? "var(--ctp-surface0)"
                          : "transparent",
                        borderBottom: "1px solid var(--ctp-surface0)",
                      }}
                      onClick={() => setSourceRevision(c.changeId)}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.backgroundColor =
                            "var(--ctp-surface0)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.backgroundColor =
                            "transparent";
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-[11px] font-bold flex-shrink-0"
                          style={{ color: "var(--ctp-mauve)" }}
                        >
                          {c.changeId}
                        </span>
                        {c.bookmarks.map((b) => (
                          <span
                            key={b}
                            className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                            style={{
                              backgroundColor: "var(--ctp-green)",
                              color: "var(--ctp-base)",
                            }}
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                      <div
                        className="text-[11px] truncate mt-0.5"
                        style={{
                          color: c.description
                            ? "var(--ctp-text)"
                            : "var(--ctp-overlay0)",
                          fontStyle: c.description ? "normal" : "italic",
                        }}
                      >
                        {c.description || "(no description)"}
                      </div>
                      <div
                        className="text-[10px] mt-0.5"
                        style={{ color: "var(--ctp-overlay0)" }}
                      >
                        {c.author} &middot; {c.timestamp}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right panel — diff preview */}
          <div ref={diffPanelRef} className="flex-1 min-w-0 flex flex-col">
            {sourceRevision && previewData && !isLoadingPreview ? (
              <>
                {/* Diff header with mode toggle */}
                <div
                  className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
                  style={{
                    backgroundColor: "var(--ctp-mantle)",
                    borderBottom: "1px solid var(--ctp-surface0)",
                  }}
                >
                  <span
                    className="text-[10px] font-mono truncate"
                    style={{ color: "var(--ctp-subtext0)" }}
                  >
                    {filePath}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      className="px-2 py-0.5 text-[10px] rounded transition-colors"
                      style={{
                        backgroundColor:
                          displayMode === "unified"
                            ? "var(--ctp-surface1)"
                            : "transparent",
                        color: "var(--ctp-text)",
                      }}
                      onClick={() => setDisplayMode("unified")}
                    >
                      Unified
                    </button>
                    <button
                      className="px-2 py-0.5 text-[10px] rounded transition-colors"
                      style={{
                        backgroundColor:
                          displayMode === "side-by-side"
                            ? "var(--ctp-surface1)"
                            : "transparent",
                        color: "var(--ctp-text)",
                      }}
                      onClick={() => setDisplayMode("side-by-side")}
                    >
                      Side-by-Side
                    </button>
                  </div>
                </div>
                {sideBySideTooNarrow && (
                  <div
                    className="flex items-center gap-1.5 px-3 py-1 flex-shrink-0"
                    style={{
                      backgroundColor: "var(--ctp-yellow)",
                      color: "var(--ctp-base)",
                    }}
                  >
                    <span className="text-[10px] font-medium">
                      Window too narrow for side-by-side — showing unified. Resize wider or switch to Unified.
                    </span>
                  </div>
                )}
                {/* Key includes displayMode to force remount when toggling */}
                <div key={`${sourceRevision}-${displayMode}`} className="flex-1 min-h-0">
                  <MonacoDiffViewer
                    originalContent={previewData.originalContent}
                    modifiedContent={previewData.modifiedContent}
                    language={previewData.language}
                    filePath={previewData.filePath}
                    displayMode={displayMode}
                  />
                </div>
              </>
            ) : (
              <div
                className="flex flex-col items-center justify-center h-full gap-2"
                style={{ color: "var(--ctp-subtext0)" }}
              >
                {isLoadingPreview ? (
                  <span className="text-xs">Loading preview...</span>
                ) : (
                  <>
                    <span className="text-sm">Select a Revision</span>
                    <span className="text-xs opacity-60">
                      Click a revision on the left to preview the changes.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--ctp-surface0)" }}
        >
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!sourceRevision}
            className="px-3 py-1.5 text-xs font-medium rounded transition-colors hover:opacity-80"
            style={{
              backgroundColor: sourceRevision
                ? "var(--ctp-mauve)"
                : "var(--ctp-surface1)",
              color: sourceRevision
                ? "var(--ctp-base)"
                : "var(--ctp-overlay0)",
              cursor: sourceRevision ? "pointer" : "default",
            }}
          >
            Restore
          </button>
        </div>

        {/* Resize handle — right edge */}
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize"
          onMouseDown={handleResizeRight}
        />
        {/* Resize handle — bottom edge */}
        <div
          className="absolute bottom-0 left-0 h-1.5 w-full cursor-ns-resize"
          onMouseDown={handleResizeBottom}
        />
        {/* Resize handle — bottom-right corner */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={handleResizeCorner}
        />
      </div>
    </div>
  );
}
