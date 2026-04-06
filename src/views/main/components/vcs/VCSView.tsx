// ============================================================
// VCSView — main orchestrator for VCS commit operations.
// Layout: left panel (file list + commit panel), right panel (Monaco diff).
// Modeled after IntelliJ's commit view.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  VCSFileEntry,
  VCSFileDiffResult,
  GitCommitEntry,
  GitScopedFileEntry,
  FileAIContext,
  FileChangeTimeline,
} from "../../../../shared/ipc-types";
import { VCSType, DiffScope, ViewMode } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { askClaudeAboutSelection } from "../../state/actions";
import { useStore } from "../../state/store";
import { VCSFileList } from "./VCSFileList";
import { VCSCommitPanel } from "./VCSCommitPanel";
import {
  MonacoDiffViewer,
  VCSDiffHeader,
  type MonacoDiffViewerHandle,
  type MonacoSelection,
} from "./MonacoDiffViewer";
import { JJView } from "./JJView";
import { GitScopeSelector } from "./GitScopeSelector";
import { GitCommitPicker } from "./GitCommitPicker";
import { GitScopedFileList } from "./GitScopedFileList";
import { AIContextPanel } from "../diff/AIContextPanel";
import { GitFileContextMenu } from "./GitFileContextMenu";

export function VCSView() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const repos = useStore((s) => s.repos);
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);

  // Determine VCS type for current workspace
  const vcsType = useVCSType(selectedWorkspacePath, repos, workspacesByRepo);

  if (!selectedWorkspacePath) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">No workspace selected</span>
        <span className="text-xs opacity-60">Select a workspace to manage changes.</span>
      </div>
    );
  }

  if (vcsType === VCSType.JJ) {
    return <JJView workspacePath={selectedWorkspacePath} />;
  }

  return <GitVCSView workspacePath={selectedWorkspacePath} />;
}

// --- Hook to determine VCS type ---

function useVCSType(
  workspacePath: string | null,
  repos: any[],
  workspacesByRepo: Record<string, any[]>,
): VCSType {
  // Find the repo for this workspace and return its vcsType
  if (!workspacePath) return VCSType.Git;
  for (const repo of repos) {
    const workspaces = workspacesByRepo[repo.id] ?? [];
    if (workspaces.some((ws: any) => ws.path === workspacePath)) {
      return repo.vcsType;
    }
  }
  return VCSType.Git;
}

// --- Git VCS View ---

function GitVCSView({ workspacePath }: { workspacePath: string }) {
  const diffViewerRef = useRef<MonacoDiffViewerHandle>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const setViewMode = useStore((s) => s.setViewMode);

  // --- Scope selection state ---
  const [viewScope, setViewScope] = useState<DiffScope>(DiffScope.CurrentChange);
  const [selectedCommitRef, setSelectedCommitRef] = useState<string | null>(null);
  const [recentCommits, setRecentCommits] = useState<GitCommitEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [scopedFiles, setScopedFiles] = useState<GitScopedFileEntry[]>([]);
  const [scopedSummary, setScopedSummary] = useState("");
  const [scopedSelectedFile, setScopedSelectedFile] = useState<string | null>(null);

  // --- Working changes state (existing) ---
  const [files, setFiles] = useState<VCSFileEntry[]>([]);
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);

  // --- AI Context state ---
  const [aiContext, setAiContext] = useState<FileAIContext | null>(null);
  const [aiTimeline, setAiTimeline] = useState<FileChangeTimeline | null>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [aiPanelRatio, setAiPanelRatio] = useState(0.3);

  // --- Shared state ---
  const [diffData, setDiffData] = useState<VCSFileDiffResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"unified" | "side-by-side">(
    "side-by-side",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [monacoSelection, setMonacoSelection] = useState<MonacoSelection | null>(null);

  // Context menu + revert confirmation
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: VCSFileEntry;
  } | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<VCSFileEntry | null>(null);

  // Left panel width (resizable)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);

  const isScoped = viewScope !== DiffScope.CurrentChange;

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Clear selection state when scope changes
  useEffect(() => {
    setSelectedFile(null);
    setScopedSelectedFile(null);
    setDiffData(null);
    setScopedFiles([]);
    setScopedSummary("");
    if (viewScope !== DiffScope.SingleCommit) {
      setSelectedCommitRef(null);
    }
  }, [viewScope]);

  // --- Working Changes data loading ---

  const loadStatus = useCallback(async () => {
    if (!workspacePath) return;
    setIsLoading(true);
    setError(null);
    try {
      const status = await api.getVCSStatus(workspacePath);
      setFiles(status.files);
      setBranch(status.branch);
      setAhead(status.ahead);
      setBehind(status.behind);
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
    setIsLoading(false);
  }, [workspacePath]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // --- Scoped data loading ---

  // Load recent commits when switching to SingleCommit mode
  useEffect(() => {
    if (viewScope !== DiffScope.SingleCommit || !workspacePath) return;
    let cancelled = false;
    setCommitsLoading(true);
    (async () => {
      try {
        const result = await api.gitGetRecentCommits(workspacePath);
        if (!cancelled) {
          setRecentCommits(result.commits);
          // Auto-select first commit if none selected
          if (!selectedCommitRef && result.commits.length > 0) {
            setSelectedCommitRef(result.commits[0]!.hash);
          }
        }
      } catch {
        if (!cancelled) setRecentCommits([]);
      }
      if (!cancelled) setCommitsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [viewScope, workspacePath]);

  // Load scoped files when scope/commitRef changes
  useEffect(() => {
    if (viewScope === DiffScope.CurrentChange || !workspacePath) return;
    if (viewScope === DiffScope.SingleCommit && !selectedCommitRef) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await api.gitGetScopedFiles(
          workspacePath,
          viewScope,
          selectedCommitRef ?? undefined,
        );
        if (!cancelled) {
          setScopedFiles(result.files);
          setScopedSummary(result.summary);
          setScopedSelectedFile(null);
          setDiffData(null);
        }
      } catch {
        if (!cancelled) {
          setScopedFiles([]);
          setScopedSummary("Error loading files");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [viewScope, selectedCommitRef, workspacePath]);

  // Load diff for selected file (working changes mode)
  useEffect(() => {
    if (isScoped || !selectedFile || !workspacePath) {
      if (!isScoped) setDiffData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const diff = await api.vcsGetFileDiff(
          workspacePath,
          selectedFile.path,
          selectedFile.staged,
        );
        if (!cancelled) setDiffData(diff);
      } catch {
        if (!cancelled) setDiffData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFile, workspacePath, isScoped]);

  // Load diff for selected file (scoped mode)
  useEffect(() => {
    if (!isScoped || !scopedSelectedFile || !workspacePath) {
      if (isScoped) setDiffData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const diff = await api.gitGetScopedFileDiff(
          workspacePath,
          viewScope,
          scopedSelectedFile,
          selectedCommitRef ?? undefined,
        );
        if (!cancelled) setDiffData(diff);
      } catch {
        if (!cancelled) setDiffData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scopedSelectedFile, workspacePath, viewScope, selectedCommitRef, isScoped]);

  // --- Load AI context when selected file changes ---

  const activeFilePath = isScoped ? scopedSelectedFile : selectedFile?.path ?? null;

  useEffect(() => {
    setCurrentChangeIndex(0);
    if (!activeFilePath || !workspacePath) {
      setAiContext(null);
      setAiTimeline(null);
      return;
    }

    const fullPath = `${workspacePath}/${activeFilePath}`;
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
          const lastIdx = tl?.changes?.length ? tl.changes.length - 1 : 0;
          setCurrentChangeIndex(lastIdx);
        }
      } catch {
        if (!cancelled) {
          setAiContext(null);
          setAiTimeline(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeFilePath, workspacePath]);

  // --- Stage/unstage operations ---

  const handleStageFiles = useCallback(
    async (paths: string[]) => {
      await api.vcsStageFiles(workspacePath, paths);
      await loadStatus();
    },
    [workspacePath, loadStatus],
  );

  const handleUnstageFiles = useCallback(
    async (paths: string[]) => {
      await api.vcsUnstageFiles(workspacePath, paths);
      await loadStatus();
    },
    [workspacePath, loadStatus],
  );

  const handleStageAll = useCallback(async () => {
    await api.vcsStageAll(workspacePath);
    await loadStatus();
  }, [workspacePath, loadStatus]);

  const handleUnstageAll = useCallback(async () => {
    await api.vcsUnstageAll(workspacePath);
    await loadStatus();
  }, [workspacePath, loadStatus]);

  // --- Context menu + revert ---

  const handleFileContextMenu = useCallback(
    (file: VCSFileEntry, x: number, y: number) => {
      setContextMenu({ x, y, file });
    },
    [],
  );

  const handleRevertConfirmed = useCallback(async () => {
    if (!revertConfirm) return;
    const result = await api.vcsRevertFiles(workspacePath, [revertConfirm.path]);
    if (result.success) {
      setToast({ message: `Reverted ${revertConfirm.path}`, type: "success" });
      // Clear selection if the reverted file was selected
      if (selectedFile?.path === revertConfirm.path) {
        setSelectedFile(null);
        setDiffData(null);
      }
      await loadStatus();
    } else {
      setToast({ message: result.error ?? "Revert failed", type: "error" });
    }
    setRevertConfirm(null);
  }, [workspacePath, revertConfirm, selectedFile, loadStatus]);

  // --- Commit ---

  const handleCommit = useCallback(
    async (message: string, amend: boolean) => {
      setIsCommitting(true);
      try {
        const result = await api.vcsCommit(workspacePath, message, amend);
        if (result.success) {
          setToast({ message: `Committed ${result.commitHash ?? ""}`, type: "success" });
          await loadStatus();
        } else {
          setToast({ message: result.error ?? "Commit failed", type: "error" });
        }
      } catch (err: any) {
        setToast({ message: err.message ?? "Commit failed", type: "error" });
      }
      setIsCommitting(false);
    },
    [workspacePath, loadStatus],
  );

  const handleCommitAndPush = useCallback(
    async (message: string, amend: boolean) => {
      setIsCommitting(true);
      try {
        const commitResult = await api.vcsCommit(workspacePath, message, amend);
        if (!commitResult.success) {
          setToast({ message: commitResult.error ?? "Commit failed", type: "error" });
          setIsCommitting(false);
          return;
        }

        const pushResult = await api.vcsPush(workspacePath);
        if (pushResult.success) {
          setToast({ message: "Committed and pushed", type: "success" });
        } else {
          setToast({
            message: `Committed but push failed: ${pushResult.error}`,
            type: "error",
          });
        }
        await loadStatus();
      } catch (err: any) {
        setToast({ message: err.message ?? "Failed", type: "error" });
      }
      setIsCommitting(false);
    },
    [workspacePath, loadStatus],
  );

  // --- Divider drag ---

  const handleDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftPanelWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setLeftPanelWidth(Math.max(200, Math.min(500, startWidth + delta)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftPanelWidth],
  );

  // --- AI panel divider drag ---

  const aiDragRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const cleanupAiDrag = useCallback(() => {
    if (aiDragRef.current) {
      document.removeEventListener("mousemove", aiDragRef.current.move);
      document.removeEventListener("mouseup", aiDragRef.current.up);
      aiDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("blur", cleanupAiDrag);
    return () => {
      window.removeEventListener("blur", cleanupAiDrag);
      cleanupAiDrag();
    };
  }, [cleanupAiDrag]);

  const handleAiDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startRatio = aiPanelRatio;
      const container = (e.target as HTMLElement).closest("[data-git-content-panel]");
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;

      const move = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setAiPanelRatio(Math.min(0.6, Math.max(0.1, startRatio + delta / containerHeight)));
      };
      const up = () => cleanupAiDrag();

      aiDragRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [aiPanelRatio, cleanupAiDrag],
  );

  // Ask Claude handler
  const handleAskClaude = useCallback(() => {
    if (!monacoSelection || !selectedFile) return;
    const fullPath = `${workspacePath}/${selectedFile.path}`;
    askClaudeAboutSelection(monacoSelection.text, fullPath, monacoSelection.lineNumber);
    setMonacoSelection(null);
    setViewMode(workspacePath, ViewMode.Terminal);
  }, [monacoSelection, selectedFile, workspacePath, setViewMode]);

  // Clear selection when switching files
  useEffect(() => {
    setMonacoSelection(null);
  }, [selectedFile]);

  // --- Loading/error states (only for initial status load) ---

  if (isLoading && viewScope === DiffScope.CurrentChange) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading VCS status...</span>
      </div>
    );
  }

  if (error && viewScope === DiffScope.CurrentChange) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2"
        style={{ color: "var(--ctp-red)" }}
      >
        <span className="text-sm">Error</span>
        <span
          className="text-xs max-w-md text-center"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {error}
        </span>
        <button
          className="px-3 py-1 text-xs rounded mt-2"
          style={{ background: "var(--ctp-surface0)", color: "var(--ctp-text)" }}
          onClick={loadStatus}
        >
          Retry
        </button>
      </div>
    );
  }

  const stagedCount = files.filter((f) => f.staged).length;

  // Determine the current file path and staged state for the diff header
  const currentFilePath = isScoped ? scopedSelectedFile : selectedFile?.path ?? null;
  const currentFileStaged = isScoped ? undefined : selectedFile?.staged;
  const hasFileList = isScoped ? scopedFiles.length > 0 : files.length > 0;

  return (
    <div className="flex h-full w-full relative">
      {/* Left panel — scope selector + file list + commit panel */}
      <div
        className="flex flex-col h-full flex-shrink-0"
        style={{ width: leftPanelWidth, borderRight: "1px solid var(--ctp-surface0)" }}
      >
        {/* Scope selector (always shown) */}
        <GitScopeSelector scope={viewScope} onScopeChange={setViewScope} />

        {/* Commit picker (SingleCommit mode only) */}
        {viewScope === DiffScope.SingleCommit && (
          <GitCommitPicker
            commits={recentCommits}
            selectedHash={selectedCommitRef}
            onSelect={setSelectedCommitRef}
            isLoading={commitsLoading}
          />
        )}

        {/* Working changes: file list + commit panel */}
        {viewScope === DiffScope.CurrentChange && (
          <>
            <div className="flex-1 min-h-0">
              <VCSFileList
                files={files}
                selectedFile={selectedFile}
                onSelectFile={(path, staged) => setSelectedFile({ path, staged })}
                onStageFiles={handleStageFiles}
                onUnstageFiles={handleUnstageFiles}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
                onContextMenu={handleFileContextMenu}
              />
            </div>
            <VCSCommitPanel
              branch={branch}
              ahead={ahead}
              behind={behind}
              stagedCount={stagedCount}
              onCommit={handleCommit}
              onCommitAndPush={handleCommitAndPush}
              isCommitting={isCommitting}
            />
          </>
        )}

        {/* Scoped modes: read-only file list */}
        {isScoped && (
          <div className="flex-1 min-h-0">
            <GitScopedFileList
              files={scopedFiles}
              selectedFilePath={scopedSelectedFile}
              onSelectFile={setScopedSelectedFile}
              summary={scopedSummary}
            />
          </div>
        )}
      </div>

      {/* Resizable divider */}
      <div
        className="flex-shrink-0 cursor-col-resize hover:opacity-100 transition-opacity"
        style={{
          width: 3,
          backgroundColor: "var(--ctp-surface0)",
          opacity: 0.6,
        }}
        onMouseDown={handleDividerDrag}
      />

      {/* Right panel — diff viewer + AI context */}
      <div className="flex-1 h-full min-w-0 flex flex-col" data-git-content-panel>
        {/* Diff area */}
        <div style={{ flex: `${1 - aiPanelRatio}` }} className="min-h-0 flex flex-col">
          {currentFilePath && diffData ? (
            <>
              <VCSDiffHeader
                filePath={currentFilePath}
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                staged={currentFileStaged}
                onNextDiff={() => diffViewerRef.current?.goToNextDiff()}
                onPrevDiff={() => diffViewerRef.current?.goToPrevDiff()}
              />
              <div ref={diffContainerRef} className="flex-1 min-h-0 relative">
                <MonacoDiffViewer
                  ref={diffViewerRef}
                  originalContent={diffData.originalContent}
                  modifiedContent={diffData.modifiedContent}
                  language={diffData.language}
                  filePath={diffData.filePath}
                  displayMode={displayMode}
                  onTextSelection={setMonacoSelection}
                />
                {monacoSelection && diffContainerRef.current && (() => {
                  const containerRect = diffContainerRef.current!.getBoundingClientRect();
                  const relX = monacoSelection.x - containerRect.left;
                  const relY = monacoSelection.y - containerRect.top;
                  return (
                    <button
                      className="absolute z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium shadow-lg transition-opacity hover:opacity-90"
                      style={{
                        left: Math.max(8, Math.min(relX - 40, containerRect.width - 100)),
                        top: Math.max(4, relY - 32),
                        backgroundColor: "var(--ctp-mauve)",
                        color: "var(--ctp-base)",
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleAskClaude}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      Ask Claude
                    </button>
                  );
                })()}
              </div>
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center h-full gap-2"
              style={{ color: "var(--ctp-subtext0)" }}
            >
              {!hasFileList ? (
                <>
                  <span className="text-sm">No Changes</span>
                  <span className="text-xs opacity-60">
                    {isScoped ? "No files in this scope." : "Working tree is clean."}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm">Select a File</span>
                  <span className="text-xs opacity-60">
                    Click a file in the sidebar to view its diff.
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Draggable horizontal divider for AI panel */}
        <div
          className="flex-shrink-0 cursor-row-resize"
          style={{
            height: 3,
            background: "var(--ctp-mauve)",
            opacity: 0.6,
          }}
          onMouseDown={handleAiDividerDrag}
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

      {/* Context menu */}
      {contextMenu && (
        <GitFileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          filePath={contextMenu.file.path}
          onRevert={() => {
            setRevertConfirm(contextMenu.file);
            setContextMenu(null);
          }}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {/* Revert confirmation dialog */}
      {revertConfirm && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setRevertConfirm(null)}
          />
          {/* Dialog */}
          <div
            className="relative rounded-lg shadow-xl p-4 max-w-sm"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
            }}
          >
            <p className="text-sm mb-1" style={{ color: "var(--ctp-text)" }}>
              Revert changes?
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--ctp-subtext0)" }}>
              Revert <strong>{revertConfirm.path.split("/").pop()}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs rounded"
                style={{ background: "var(--ctp-surface1)", color: "var(--ctp-text)" }}
                onClick={() => setRevertConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 text-xs rounded font-semibold"
                style={{ background: "var(--ctp-red)", color: "var(--ctp-base)" }}
                onClick={handleRevertConfirmed}
              >
                Revert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className="absolute bottom-4 right-4 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50 transition-opacity"
          style={{
            backgroundColor:
              toast.type === "success" ? "var(--ctp-green)" : "var(--ctp-red)",
            color: "var(--ctp-base)",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
