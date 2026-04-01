// ============================================================
// JJView — main orchestrator for Jujutsu VCS operations.
// Layout: left panel (toolbar + revision log),
// right panel (change detail + description + files + Monaco diff).
// Modeled after JJ GUI.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  JJRevision,
  JJChangedFile,
  JJBookmark,
  VCSFileDiffResult,
} from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { JJRevisionLog } from "./JJRevisionLog";
import { JJToolbar } from "./JJToolbar";
import { JJChangeDetail } from "./JJChangeDetail";
import {
  MonacoDiffViewer,
  VCSDiffHeader,
  type MonacoDiffViewerHandle,
} from "./MonacoDiffViewer";
import { JJContextMenu } from "./JJContextMenu";
import { JJBookmarkDialog } from "./JJBookmarkDialog";
import { JJRebaseDialog } from "./JJRebaseDialog";

interface JJViewProps {
  workspacePath: string;
}

export function JJView({ workspacePath }: JJViewProps) {
  // Revision log state
  const [revisions, setRevisions] = useState<JJRevision[]>([]);
  const [currentChangeId, setCurrentChangeId] = useState("");
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<JJBookmark[]>([]);

  // Change detail state
  const [changedFiles, setChangedFiles] = useState<JJChangedFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<VCSFileDiffResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"unified" | "side-by-side">(
    "side-by-side",
  );

  // Diff viewer ref for navigation
  const diffViewerRef = useRef<MonacoDiffViewerHandle>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    changeId: string;
  } | null>(null);

  // Bookmark dialog state
  const [bookmarkDialog, setBookmarkDialog] = useState<{
    changeId: string;
  } | null>(null);

  // Rebase dialog state
  const [rebaseDialog, setRebaseDialog] = useState<{
    changeId: string;
  } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // --- Data loading ---

  const loadLog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [logResult, bms] = await Promise.all([
        api.jjLog(workspacePath),
        api.jjGetBookmarks(workspacePath),
      ]);
      setRevisions(logResult.revisions);
      setCurrentChangeId(logResult.currentChangeId);
      setBookmarks(bms);

      // Auto-select current change if nothing selected
      if (!selectedChangeId && logResult.currentChangeId) {
        setSelectedChangeId(logResult.currentChangeId);
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
    setIsLoading(false);
  }, [workspacePath]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  // Load changed files when revision changes
  useEffect(() => {
    if (!selectedChangeId) {
      setChangedFiles([]);
      setSelectedFilePath(null);
      setDiffData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const files = await api.jjGetChangedFiles(workspacePath, selectedChangeId);
        if (!cancelled) {
          setChangedFiles(files);
          setSelectedFilePath(null);
          setDiffData(null);
        }
      } catch {
        if (!cancelled) {
          setChangedFiles([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedChangeId, workspacePath]);

  // Load file diff when file is selected
  useEffect(() => {
    if (!selectedFilePath || !selectedChangeId) {
      setDiffData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const diff = await api.jjGetFileDiff(
          workspacePath,
          selectedChangeId,
          selectedFilePath,
        );
        if (!cancelled) setDiffData(diff);
      } catch {
        if (!cancelled) setDiffData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFilePath, selectedChangeId, workspacePath]);

  // --- Action handlers ---

  const showResult = useCallback(
    (result: { success: boolean; error?: string }, successMsg: string) => {
      if (result.success) {
        setToast({ message: successMsg, type: "success" });
        loadLog();
      } else {
        setToast({ message: result.error ?? "Operation failed", type: "error" });
      }
    },
    [loadLog],
  );

  const handleNew = useCallback(async () => {
    const result = await api.jjNew(workspacePath);
    showResult(result, "New change created");
  }, [workspacePath, showResult]);

  const handleFetch = useCallback(
    async (remote?: string, allRemotes?: boolean) => {
      const result = await api.jjFetch(workspacePath, remote, allRemotes);
      showResult(result, allRemotes ? "Fetched all remotes" : `Fetched ${remote ?? "origin"}`);
    },
    [workspacePath, showResult],
  );

  const handlePush = useCallback(
    async (bookmark?: string, allTracked?: boolean) => {
      const result = await api.jjPush(workspacePath, bookmark, allTracked);
      showResult(
        result,
        allTracked
          ? "Pushed all tracked bookmarks"
          : `Pushed bookmark: ${bookmark}`,
      );
    },
    [workspacePath, showResult],
  );

  const handleUndo = useCallback(async () => {
    const result = await api.jjUndo(workspacePath);
    showResult(result, "Undo successful");
  }, [workspacePath, showResult]);

  const handleDescriptionSave = useCallback(
    async (description: string) => {
      if (!selectedChangeId) return;
      setIsSaving(true);
      const result = await api.jjDescribe(
        workspacePath,
        selectedChangeId,
        description,
      );
      if (result.success) {
        setToast({ message: "Description saved", type: "success" });
        // Refresh just the log to update the description
        try {
          const logResult = await api.jjLog(workspacePath);
          setRevisions(logResult.revisions);
          setCurrentChangeId(logResult.currentChangeId);
        } catch {
          // Ignore — log will refresh on next action
        }
      } else {
        setToast({ message: result.error ?? "Save failed", type: "error" });
      }
      setIsSaving(false);
    },
    [selectedChangeId, workspacePath],
  );

  const handleAbandon = useCallback(async () => {
    if (!selectedChangeId) return;
    const result = await api.jjAbandon(workspacePath, selectedChangeId);
    if (result.success) {
      setToast({ message: "Change abandoned", type: "success" });
      setSelectedChangeId(null);
      loadLog();
    } else {
      setToast({ message: result.error ?? "Abandon failed", type: "error" });
    }
  }, [selectedChangeId, workspacePath, loadLog]);

  // --- Context menu actions ---

  const handleContextMenu = useCallback(
    (changeId: string, x: number, y: number) => {
      setContextMenu({ x, y, changeId });
    },
    [],
  );

  const handleEdit = useCallback(async () => {
    if (!contextMenu) return;
    const result = await api.jjEdit(workspacePath, contextMenu.changeId);
    showResult(result, `Now editing ${contextMenu.changeId}`);
    setContextMenu(null);
  }, [workspacePath, contextMenu, showResult]);

  const handleOpenBookmarkDialog = useCallback(() => {
    if (!contextMenu) return;
    setBookmarkDialog({ changeId: contextMenu.changeId });
    setContextMenu(null);
  }, [contextMenu]);

  const handleBookmarkSet = useCallback(
    async (name: string, track: boolean) => {
      if (!bookmarkDialog) return;
      const result = await api.jjBookmarkSet(
        workspacePath,
        bookmarkDialog.changeId,
        name,
        track,
      );
      if (result.success) {
        setToast({ message: `Bookmark "${name}" set`, type: "success" });
        loadLog();
      } else {
        setToast({ message: result.error ?? "Failed to set bookmark", type: "error" });
      }
      setBookmarkDialog(null);
    },
    [workspacePath, bookmarkDialog, loadLog],
  );

  const handleOpenRebaseDialog = useCallback(() => {
    if (!contextMenu) return;
    setRebaseDialog({ changeId: contextMenu.changeId });
    setContextMenu(null);
  }, [contextMenu]);

  const handleRebase = useCallback(
    async (destination: string) => {
      if (!rebaseDialog) return;
      const result = await api.jjRebase(
        workspacePath,
        rebaseDialog.changeId,
        destination,
      );
      if (result.success) {
        setToast({
          message: `Rebased ${rebaseDialog.changeId} onto ${destination}`,
          type: "success",
        });
        loadLog();
      } else {
        setToast({ message: result.error ?? "Rebase failed", type: "error" });
      }
      setRebaseDialog(null);
    },
    [workspacePath, rebaseDialog, loadLog],
  );

  // Divider drag for left panel resize
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

  // --- Get selected revision ---
  const selectedRevision =
    revisions.find((r) => r.changeId === selectedChangeId) ?? null;

  // --- Render ---

  if (isLoading && revisions.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading JJ log...</span>
      </div>
    );
  }

  if (error && revisions.length === 0) {
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
          style={{
            background: "var(--ctp-surface0)",
            color: "var(--ctp-text)",
          }}
          onClick={loadLog}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full relative">
      {/* Left panel — toolbar + revision log */}
      <div
        className="flex flex-col h-full flex-shrink-0"
        style={{
          width: leftPanelWidth,
          borderRight: "1px solid var(--ctp-surface0)",
        }}
      >
        {/* Toolbar: New, Fetch, Push, Undo */}
        <JJToolbar
          bookmarks={bookmarks}
          onNew={handleNew}
          onFetch={handleFetch}
          onPush={handlePush}
          onUndo={handleUndo}
          isLoading={isLoading}
        />

        {/* Revision log header */}
        <div
          className="flex items-center px-2 py-1.5 flex-shrink-0"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            borderBottom: "1px solid var(--ctp-surface0)",
          }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            Revisions
          </span>
        </div>

        {/* Revision list (scrollable) */}
        <div className="flex-1 min-h-0">
          <JJRevisionLog
            revisions={revisions}
            selectedChangeId={selectedChangeId}
            currentChangeId={currentChangeId}
            onSelectRevision={setSelectedChangeId}
            onContextMenu={handleContextMenu}
          />
        </div>
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

      {/* Right panel — change detail + diff */}
      <div className="flex-1 h-full min-w-0 flex flex-col">
        {selectedRevision ? (
          <>
            {/* Top: change detail + description + files */}
            <div
              className="flex-shrink-0"
              style={{
                borderBottom: "1px solid var(--ctp-surface0)",
                maxHeight: "50%",
                overflow: "auto",
              }}
            >
              <JJChangeDetail
                revision={selectedRevision}
                changedFiles={changedFiles}
                selectedFilePath={selectedFilePath}
                onDescriptionSave={handleDescriptionSave}
                onAbandon={handleAbandon}
                onSelectFile={setSelectedFilePath}
                isSaving={isSaving}
              />
            </div>

            {/* Bottom: diff viewer */}
            <div className="flex-1 min-h-0 flex flex-col">
              {selectedFilePath && diffData ? (
                <>
                  <VCSDiffHeader
                    filePath={selectedFilePath}
                    displayMode={displayMode}
                    onDisplayModeChange={setDisplayMode}
                    onNextDiff={() => diffViewerRef.current?.goToNextDiff()}
                    onPrevDiff={() => diffViewerRef.current?.goToPrevDiff()}
                  />
                  <div className="flex-1 min-h-0">
                    <MonacoDiffViewer
                      ref={diffViewerRef}
                      originalContent={diffData.originalContent}
                      modifiedContent={diffData.modifiedContent}
                      language={diffData.language}
                      filePath={diffData.filePath}
                      displayMode={displayMode}
                    />
                  </div>
                </>
              ) : (
                <div
                  className="flex flex-col items-center justify-center h-full gap-2"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  {changedFiles.length === 0 ? (
                    <>
                      <span className="text-sm">
                        {selectedRevision.isEmpty
                          ? "Empty Change"
                          : "No Changed Files"}
                      </span>
                      <span className="text-xs opacity-60">
                        {selectedRevision.isEmpty
                          ? "This change has no modifications."
                          : "Select a different revision to view changes."}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm">Select a File</span>
                      <span className="text-xs opacity-60">
                        Click a file above to view its diff.
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div
            className="flex flex-col items-center justify-center h-full gap-2"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            <span className="text-sm">Select a Revision</span>
            <span className="text-xs opacity-60">
              Click a revision in the log to view its details.
            </span>
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className="absolute bottom-4 right-4 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50"
          style={{
            backgroundColor:
              toast.type === "success" ? "var(--ctp-green)" : "var(--ctp-red)",
            color: "var(--ctp-base)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <JJContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          changeId={contextMenu.changeId}
          isImmutable={
            revisions.find((r) => r.changeId === contextMenu.changeId)
              ?.isImmutable ?? false
          }
          onEdit={handleEdit}
          onSetBookmark={handleOpenBookmarkDialog}
          onRebaseOnto={handleOpenRebaseDialog}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {/* Bookmark dialog */}
      {bookmarkDialog && (
        <JJBookmarkDialog
          changeId={bookmarkDialog.changeId}
          existingBookmarks={bookmarks.map((b) => b.name)}
          onConfirm={handleBookmarkSet}
          onCancel={() => setBookmarkDialog(null)}
        />
      )}

      {/* Rebase dialog */}
      {rebaseDialog && (
        <JJRebaseDialog
          changeId={rebaseDialog.changeId}
          revisions={revisions}
          bookmarks={bookmarks}
          onConfirm={handleRebase}
          onCancel={() => setRebaseDialog(null)}
        />
      )}
    </div>
  );
}
