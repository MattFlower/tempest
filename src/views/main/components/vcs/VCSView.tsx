// ============================================================
// VCSView — main orchestrator for VCS commit operations.
// Layout: left panel (file list + commit panel), right panel (Monaco diff).
// Modeled after IntelliJ's commit view.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { VCSFileEntry, VCSFileDiffResult } from "../../../../shared/ipc-types";
import { VCSType } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { VCSFileList } from "./VCSFileList";
import { VCSCommitPanel } from "./VCSCommitPanel";
import {
  MonacoDiffViewer,
  VCSDiffHeader,
  type MonacoDiffViewerHandle,
} from "./MonacoDiffViewer";
import { JJView } from "./JJView";

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
  const [files, setFiles] = useState<VCSFileEntry[]>([]);
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  const [diffData, setDiffData] = useState<VCSFileDiffResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"unified" | "side-by-side">(
    "side-by-side",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Left panel width (resizable)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load status
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

  // Load diff for selected file
  useEffect(() => {
    if (!selectedFile || !workspacePath) {
      setDiffData(null);
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
  }, [selectedFile, workspacePath]);

  // Stage/unstage operations
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

  // Commit
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

  // Commit and Push
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

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span className="text-sm">Loading VCS status...</span>
      </div>
    );
  }

  if (error) {
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

  return (
    <div className="flex h-full w-full relative">
      {/* Left panel — file list + commit panel */}
      <div
        className="flex flex-col h-full flex-shrink-0"
        style={{ width: leftPanelWidth, borderRight: "1px solid var(--ctp-surface0)" }}
      >
        {/* File list (scrollable) */}
        <div className="flex-1 min-h-0">
          <VCSFileList
            files={files}
            selectedFile={selectedFile}
            onSelectFile={(path, staged) => setSelectedFile({ path, staged })}
            onStageFiles={handleStageFiles}
            onUnstageFiles={handleUnstageFiles}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
          />
        </div>

        {/* Commit panel (fixed at bottom) */}
        <VCSCommitPanel
          branch={branch}
          ahead={ahead}
          behind={behind}
          stagedCount={stagedCount}
          onCommit={handleCommit}
          onCommitAndPush={handleCommitAndPush}
          isCommitting={isCommitting}
        />
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

      {/* Right panel — diff viewer */}
      <div className="flex-1 h-full min-w-0 flex flex-col">
        {selectedFile && diffData ? (
          <>
            <VCSDiffHeader
              filePath={selectedFile.path}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              staged={selectedFile.staged}
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
            {files.length === 0 ? (
              <>
                <span className="text-sm">No Changes</span>
                <span className="text-xs opacity-60">
                  Working tree is clean.
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
