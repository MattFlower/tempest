// ============================================================
// DiffView — port of DiffView.swift
// Main orchestrator: two-panel layout with file tree sidebar
// on the left and diff content on the right.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  DiffFile,
  FileAIContext,
  FileChangeTimeline,
} from "../../../../shared/ipc-types";
import { DiffScope, PaneTabKind, ViewMode } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { createTab, createPane, allPanes, addingPane, toNodeState } from "../../models/pane-node";
import { FileTreeView } from "./FileTreeView";
import { DiffContent } from "./DiffContent";
import { DiffHeader } from "./DiffHeader";
import { DiffContextMenu } from "./DiffContextMenu";
import { AIContextPanel } from "./AIContextPanel";
import { parseDiffFileStats } from "./diff-utils";

export function DiffView() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const [files, setFiles] = useState<DiffFile[]>([]);
  const [rawDiff, setRawDiff] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scope, setScope] = useState<DiffScope>(DiffScope.CurrentChange);
  const [displayMode, setDisplayMode] = useState<"unified" | "side-by-side">(
    "side-by-side",
  );
  const [hunkIndex, setHunkIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI Context state
  const [aiContext, setAiContext] = useState<FileAIContext | null>(null);
  const [aiTimeline, setAiTimeline] = useState<FileChangeTimeline | null>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [aiContextPaths, setAiContextPaths] = useState<Set<string>>(new Set());
  const [aiPanelRatio, setAiPanelRatio] = useState(0.3); // 0.1 to 0.6

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lineNumber: number | null;
    filePath: string;
  } | null>(null);

  const paneTrees = useStore((s) => s.paneTrees);
  const setViewMode = useStore((s) => s.setViewMode);

  // Cache raw diffs per file for quick switching
  const rawDiffsByFile = useRef<Map<string, string>>(new Map());

  // Load diff from backend
  const loadDiff = useCallback(async () => {
    if (!selectedWorkspacePath) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.getDiff(selectedWorkspacePath, scope);
      setFiles(result.files);
      setRawDiff(result.raw);

      // Parse per-file raw diffs from the full raw diff
      const fileMap = parsePerFileDiffs(result.raw);
      rawDiffsByFile.current = fileMap;

      // Auto-select first file if nothing selected
      if (result.files.length > 0) {
        setSelectedPath((prev) => {
          if (prev && result.files.some((f) => f.newPath === prev)) return prev;
          return result.files[0]!.newPath;
        });
      } else {
        setSelectedPath(null);
      }

      setIsLoading(false);
    } catch (err: any) {
      console.error("[DiffView] load error:", err);
      setError(err.message ?? String(err));
      setIsLoading(false);
    }
  }, [selectedWorkspacePath, scope]);

  // Load on mount and scope change
  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  // Reset hunk index and load AI context when file changes
  useEffect(() => {
    setHunkIndex(0);
    setCurrentChangeIndex(0);

    if (!selectedPath || !selectedWorkspacePath) {
      setAiContext(null);
      setAiTimeline(null);
      return;
    }

    const fullPath = `${selectedWorkspacePath}/${selectedPath}`;
    let cancelled = false;

    (async () => {
      try {
        const [ctx, tl] = await Promise.all([
          api.getAIContextForFile(fullPath),
          api.getAITimelineForFile(fullPath),
        ]);
        if (!cancelled) {
          setAiContext(ctx);
          setAiTimeline(tl);
        }
      } catch {
        if (!cancelled) {
          setAiContext(null);
          setAiTimeline(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPath, selectedWorkspacePath]);

  // Load AI context indicators for all files when diff loads
  useEffect(() => {
    if (!selectedWorkspacePath || files.length === 0) {
      setAiContextPaths(new Set());
      return;
    }

    let cancelled = false;

    (async () => {
      const paths = new Set<string>();
      for (const file of files) {
        try {
          const ctx = await api.getAIContextForFile(
            `${selectedWorkspacePath}/${file.newPath}`,
          );
          if (ctx && ctx.sessions.length > 0) {
            paths.add(file.newPath);
          }
        } catch {
          // skip
        }
      }
      if (!cancelled) setAiContextPaths(paths);
    })();

    return () => { cancelled = true; };
  }, [files, selectedWorkspacePath]);

  // Get raw diff for selected file
  const selectedFileDiff = selectedPath
    ? rawDiffsByFile.current.get(selectedPath) ?? ""
    : "";

  const selectedFile = files.find((f) => f.newPath === selectedPath);
  const { addedLines, deletedLines, totalHunks } = selectedFileDiff
    ? parseDiffFileStats(selectedFileDiff)
    : { addedLines: 0, deletedLines: 0, totalHunks: 0 };

  const handleScopeChange = useCallback((newScope: DiffScope) => {
    setScope(newScope);
    setSelectedPath(null);
  }, []);

  const handlePreviousHunk = useCallback(() => {
    setHunkIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextHunk = useCallback(() => {
    setHunkIndex((prev) => Math.min(totalHunks - 1, prev + 1));
  }, [totalHunks]);

  const handleContextMenuLine = useCallback(
    (lineNumber: number | null, fp: string, x: number, y: number) => {
      setContextMenu({ x, y, lineNumber, filePath: fp });
    },
    [],
  );

  const handleDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startRatio = aiPanelRatio;
      const container = (e.target as HTMLElement).closest(
        "[data-diff-right-panel]",
      );
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;

      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const newRatio = Math.min(
          0.6,
          Math.max(0.1, startRatio + delta / containerHeight),
        );
        setAiPanelRatio(newRatio);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [aiPanelRatio],
  );

  const handleOpenInEditor = useCallback(() => {
    if (!contextMenu || !selectedWorkspacePath) return;

    const tree = paneTrees[selectedWorkspacePath];
    if (!tree) return;

    // Create a new pane with the editor tab, placed after the last pane
    const panes = allPanes(tree);
    const lastPaneId = panes[panes.length - 1]?.id;
    if (!lastPaneId) return;

    const fullPath = `${selectedWorkspacePath}/${contextMenu.filePath}`;
    const label = contextMenu.filePath.split("/").pop() ?? "Editor";
    const tab = createTab(PaneTabKind.Editor, label, {
      terminalId: crypto.randomUUID(),
      editorFilePath: fullPath,
      editorLineNumber: contextMenu.lineNumber ?? undefined,
    });
    const newPane = createPane(tab);
    const newTree = addingPane(tree, newPane, lastPaneId);

    // Commit the tree and focus the new pane
    useStore.getState().setPaneTree(selectedWorkspacePath, newTree);
    useStore.getState().setFocusedPaneId(newPane.id);
    api.notifyPaneTreeChanged(selectedWorkspacePath, toNodeState(newTree));

    setContextMenu(null);
    // Switch to Terminal view so the new editor pane is visible
    setViewMode(selectedWorkspacePath, ViewMode.Terminal);
  }, [contextMenu, selectedWorkspacePath, paneTrees, setViewMode]);

  if (!selectedWorkspacePath) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">No workspace selected</span>
        <span className="text-xs opacity-60">
          Select a workspace to view its changes.
        </span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading changes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-red)" }}
      >
        <span className="text-sm">Error Loading Diff</span>
        <span
          className="text-xs max-w-md text-center"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {error}
        </span>
        <button
          className="px-3 py-1 text-xs rounded mt-2"
          style={{
            background: "var(--ctp-surface0)",
            color: "var(--ctp-text)",
          }}
          onClick={loadDiff}
        >
          Retry
        </button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full w-full">
        {/* Keep file tree for scope switching */}
        <div
          className="flex-shrink-0 h-full"
          style={{
            width: 200,
            borderRight: "1px solid var(--ctp-surface0)",
          }}
        >
          <FileTreeView
            files={[]}
            selectedPath={null}
            onSelectFile={() => {}}
            scope={scope}
            onScopeChange={handleScopeChange}
            aiContextPaths={aiContextPaths}
          />
        </div>
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          <span className="text-sm">No Changes</span>
          <span className="text-xs opacity-60">
            {scope === DiffScope.CurrentChange
              ? "This workspace has no uncommitted changes."
              : "No changes found between trunk and the current state."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {/* Left panel — file tree */}
      <div
        className="flex-shrink-0 h-full"
        style={{
          width: 200,
          borderRight: "1px solid var(--ctp-surface0)",
        }}
      >
        <FileTreeView
          files={files}
          selectedPath={selectedPath}
          onSelectFile={setSelectedPath}
          scope={scope}
          onScopeChange={handleScopeChange}
          aiContextPaths={aiContextPaths}
        />
      </div>

      {/* Right panel — diff header + content + AI panel */}
      <div className="flex-1 h-full min-w-0 flex flex-col" data-diff-right-panel>
        {selectedPath && selectedFile ? (
          <>
            <DiffHeader
              filePath={selectedPath}
              addedLines={addedLines}
              deletedLines={deletedLines}
              hunkIndex={hunkIndex}
              totalHunks={totalHunks}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              onPreviousHunk={handlePreviousHunk}
              onNextHunk={handleNextHunk}
            />
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Diff content area */}
              <div style={{ flex: `${1 - aiPanelRatio}` }} className="min-h-0">
                <DiffContent
                  rawDiff={selectedFileDiff}
                  displayMode={displayMode}
                  hunkIndex={hunkIndex}
                  filePath={selectedPath}
                  onContextMenuLine={handleContextMenuLine}
                />
              </div>
              {/* Draggable divider */}
              <div
                className="flex-shrink-0 cursor-row-resize"
                style={{
                  height: 3,
                  background: "var(--ctp-mauve)",
                  opacity: 0.6,
                }}
                onMouseDown={handleDividerDrag}
              />
              {/* AI Context Panel */}
              <div style={{ flex: `${aiPanelRatio}` }} className="min-h-0">
                <AIContextPanel
                  context={aiContext}
                  timeline={aiTimeline}
                  currentChangeIndex={currentChangeIndex}
                  onChangeIndex={setCurrentChangeIndex}
                />
              </div>
            </div>
          </>
        ) : (
          <div
            className="flex flex-col items-center justify-center h-full gap-2"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            <span className="text-sm">Select a File</span>
            <span className="text-xs opacity-60">
              Choose a file from the sidebar to view its changes.
            </span>
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <DiffContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          lineNumber={contextMenu.lineNumber}
          onOpenInEditor={handleOpenInEditor}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Parse per-file raw diffs from a combined unified diff string.
 * Returns a map of filePath -> raw diff string for that file.
 */
function parsePerFileDiffs(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = raw.split("\n");
  let currentStart = -1;
  let currentPath: string | null = null;

  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i]! : null;
    const isFileBoundary = line?.startsWith("diff --git ") ?? false;
    const isEnd = i === lines.length;

    if ((isFileBoundary || isEnd) && currentPath !== null && currentStart >= 0) {
      // Save the previous file's diff
      const fileDiff = lines.slice(currentStart, i).join("\n");
      map.set(currentPath, fileDiff);
    }

    if (isFileBoundary && line) {
      currentStart = i;
      // Extract new path from "diff --git a/old b/new"
      const stripped = line.replace("diff --git ", "");
      const parts = stripped.split(" b/");
      currentPath = parts.length >= 2 ? parts.slice(1).join(" b/") : null;
    }
  }

  return map;
}
