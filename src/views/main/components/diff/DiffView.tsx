// ============================================================
// DiffView — port of DiffView.swift
// Main orchestrator: two-panel layout with file tree sidebar
// on the left and diff content on the right.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { DiffFile } from "../../../../shared/ipc-types";
import { DiffScope } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { FileTreeView } from "./FileTreeView";
import { DiffContent } from "./DiffContent";
import { DiffHeader } from "./DiffHeader";
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

  // Reset hunk index when file changes
  useEffect(() => {
    setHunkIndex(0);
  }, [selectedPath]);

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
        />
      </div>

      {/* Right panel — diff header + content */}
      <div className="flex-1 h-full min-w-0 flex flex-col">
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
            <div className="flex-1 min-h-0">
              <DiffContent
                rawDiff={selectedFileDiff}
                displayMode={displayMode}
                hunkIndex={hunkIndex}
              />
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
