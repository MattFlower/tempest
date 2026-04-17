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
  FileAIContext,
  FileChangeTimeline,
} from "../../../../shared/ipc-types";
import { ViewMode } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { askClaudeAboutSelection } from "../../state/actions";
import { useStore } from "../../state/store";
import { JJRevisionLog } from "./JJRevisionLog";
import { JJToolbar } from "./JJToolbar";
import { JJChangeDetail } from "./JJChangeDetail";
import {
  MonacoDiffViewer,
  VCSDiffHeader,
  type MonacoDiffViewerHandle,
  type MonacoSelection,
} from "./MonacoDiffViewer";
import { JJContextMenu } from "./JJContextMenu";
import { JJFileContextMenu } from "./JJFileContextMenu";
import { JJBookmarkDialog } from "./JJBookmarkDialog";
import { JJRebaseDialog } from "./JJRebaseDialog";
import { JJRestoreFromDialog } from "./JJRestoreFromDialog";
import { AIContextPanel } from "../ai-context/AIContextPanel";

const DEFAULT_REVSET = "heads(::@ & ::trunk())..@";
const DEFAULT_BOUNDS = { from: "heads(::@ & ::trunk())", to: "@" };

type JJPreset = "since-branch" | "recent" | "custom";

const PRESETS: Record<JJPreset, { label: string; revset: string; isRange: boolean | null }> = {
  "since-branch": {
    label: "Since branch started",
    revset: "heads(::@ & ::trunk())..@",
    isRange: true,
  },
  "recent": {
    label: "Recent Revisions",
    revset: "present(@) | ancestors(immutable_heads().., 2) | trunk()",
    isRange: false,
  },
  "custom": {
    label: "Custom revset\u2026",
    revset: "",
    isRange: null,
  },
};

/**
 * Parse a JJ revset of the form "A..B" into from/to bounds.
 * The ".." is the JJ range operator (distinct from "::" which uses colons).
 * Returns null if the revset doesn't contain a ".." range.
 */
function parseRevsetBounds(revset: string): { from: string; to: string } | null {
  // Find ".." that is NOT part of "::" — scan for standalone ".."
  // JJ uses "::" for ancestors/descendants, ".." for ranges
  const trimmed = revset.trim();
  // Search for ".." not preceded or followed by another "."
  let i = 0;
  while (i < trimmed.length - 1) {
    if (trimmed[i] === "." && trimmed[i + 1] === ".") {
      // Check it's not part of "..." (three dots)
      if (i + 2 < trimmed.length && trimmed[i + 2] === ".") {
        i += 3;
        continue;
      }
      const from = trimmed.substring(0, i).trim();
      const to = trimmed.substring(i + 2).trim() || "@";
      if (from) return { from, to };
    }
    i++;
  }
  return null;
}

function JJPresetSelector({
  preset,
  customRevset,
  error,
  onPresetChange,
  onCustomSubmit,
}: {
  preset: JJPreset;
  customRevset: string;
  error: string | null;
  onPresetChange: (preset: JJPreset) => void;
  onCustomSubmit: (value: string) => void;
}) {
  const [customValue, setCustomValue] = useState(customRevset);

  useEffect(() => {
    setCustomValue(customRevset);
  }, [customRevset]);

  return (
    <div
      className="flex-shrink-0 px-2 py-1.5"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as JJPreset)}
        className="w-full px-1.5 py-0.5 rounded text-[11px]"
        style={{
          backgroundColor: "var(--ctp-surface0)",
          color: "var(--ctp-text)",
          border: "1px solid var(--ctp-surface1)",
          outline: "none",
        }}
      >
        {(Object.keys(PRESETS) as JJPreset[]).map((key) => (
          <option key={key} value={key}>
            {PRESETS[key].label}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <div className="flex items-center gap-1 mt-1">
          <input
            className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-[11px] font-mono"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: error
                ? "1px solid var(--ctp-red)"
                : "1px solid var(--ctp-surface1)",
              outline: "none",
            }}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCustomSubmit(customValue.trim());
            }}
            placeholder="e.g. trunk()..@ or mine()"
            spellCheck={false}
            autoFocus
          />
        </div>
      )}
      {error && (
        <div
          className="text-[10px] mt-0.5 px-0.5"
          style={{ color: "var(--ctp-red)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

interface JJViewProps {
  workspacePath: string;
}

function getDefaultPreset(workspacePath: string, workspacesByRepo: Record<string, import("../../../../shared/ipc-types").TempestWorkspace[]>): JJPreset {
  for (const workspaces of Object.values(workspacesByRepo)) {
    const ws = workspaces.find((w) => w.path === workspacePath);
    if (ws) return ws.name === "default" ? "recent" : "since-branch";
  }
  return "since-branch";
}

export function JJView({ workspacePath }: JJViewProps) {
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);
  const defaultPreset = getDefaultPreset(workspacePath, workspacesByRepo);

  // Revset state
  const [activePreset, setActivePreset] = useState<JJPreset>(defaultPreset);
  const [activeRevset, setActiveRevset] = useState(PRESETS[defaultPreset].revset);
  const [revsetError, setRevsetError] = useState<string | null>(null);
  const [jjViewMode, setJJViewMode] = useState<"range" | "single">(
    PRESETS[defaultPreset].isRange ? "range" : "single",
  );
  const [rangeBounds, setRangeBounds] = useState(
    PRESETS[defaultPreset].isRange ? DEFAULT_BOUNDS : { from: "", to: "" },
  );

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

  // AI Context state
  const [aiContext, setAiContext] = useState<FileAIContext | null>(null);
  const [aiTimeline, setAiTimeline] = useState<FileChangeTimeline | null>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [aiPanelRatio, setAiPanelRatio] = useState(0.3);
  const [fileListWidth, setFileListWidth] = useState(200);
  const [aiContextPaths, setAiContextPaths] = useState<Set<string>>(new Set());

  // Ask Claude state
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const setViewMode = useStore((s) => s.setViewMode);
  const [monacoSelection, setMonacoSelection] = useState<MonacoSelection | null>(null);

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

  // File context menu state
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
  } | null>(null);

  // Restore from dialog state
  const [restoreFromDialog, setRestoreFromDialog] = useState<{
    filePath: string;
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
    setRevsetError(null);
    try {
      const [logResult, bms] = await Promise.all([
        api.jjLog(workspacePath, activeRevset),
        api.jjGetBookmarks(workspacePath),
      ]);
      setRevisions(logResult.revisions);
      setCurrentChangeId(logResult.currentChangeId);
      setBookmarks(bms);

      // Load range files if this is a range preset
      const shouldLoadRange =
        activePreset === "since-branch" ||
        (activePreset === "custom" && parseRevsetBounds(activeRevset) !== null);
      if (shouldLoadRange) {
        const bounds = parseRevsetBounds(activeRevset);
        if (bounds) {
          setRangeBounds(bounds);
          try {
            const rangeFiles = await api.jjGetRangeChangedFiles(
              workspacePath,
              bounds.from,
              bounds.to,
            );
            setChangedFiles(rangeFiles);
          } catch {
            // Range files failed — not critical
          }
        }
      }
    } catch (err: any) {
      setRevsetError(err.message ?? String(err));
      // Don't clear revisions on error — keep previous list visible
      if (revisions.length === 0) {
        setError(err.message ?? String(err));
      }
    }
    setIsLoading(false);
  }, [workspacePath, activeRevset, activePreset]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  // Auto-select working copy revision in non-range modes
  useEffect(() => {
    if (selectedChangeId || revisions.length === 0) return;
    const isRange =
      activePreset === "since-branch" ||
      (activePreset === "custom" && parseRevsetBounds(activeRevset) !== null);
    if (isRange) return;
    const wc = revisions.find((r) => r.isWorkingCopy);
    const autoSelectId = wc?.changeId || currentChangeId;
    if (autoSelectId) {
      setSelectedChangeId(autoSelectId);
    }
  }, [activePreset, activeRevset, revisions, currentChangeId, selectedChangeId]);

  // Load changed files when revision changes (single-revision mode only)
  useEffect(() => {
    if (jjViewMode !== "single" || !selectedChangeId) {
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
  }, [selectedChangeId, workspacePath, jjViewMode]);

  // Load file diff when file is selected
  useEffect(() => {
    if (!selectedFilePath) {
      setDiffData(null);
      return;
    }

    // In single mode, need a selected revision
    if (jjViewMode === "single" && !selectedChangeId) {
      setDiffData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const diff =
          jjViewMode === "range"
            ? await api.jjGetRangeFileDiff(
                workspacePath,
                rangeBounds.from,
                rangeBounds.to,
                selectedFilePath,
              )
            : await api.jjGetFileDiff(
                workspacePath,
                selectedChangeId!,
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
  }, [selectedFilePath, selectedChangeId, workspacePath, jjViewMode, rangeBounds]);

  // Load AI context when file changes
  useEffect(() => {
    setCurrentChangeIndex(0);
    if (!selectedFilePath || !workspacePath) {
      setAiContext(null);
      setAiTimeline(null);
      return;
    }

    const fullPath = `${workspacePath}/${selectedFilePath}`;
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
  }, [selectedFilePath, workspacePath]);

  // --- Pre-fetch AI context indicators for all files in the current revision/range ---

  const changedFilePathsKey = changedFiles.map((f) => f.path).join("\n");

  useEffect(() => {
    if (!workspacePath || changedFiles.length === 0) {
      setAiContextPaths(new Set());
      return;
    }

    let cancelled = false;

    (async () => {
      const paths = new Set<string>();
      const results = await Promise.all(
        changedFiles.map(async (file) => {
          try {
            const ctx = await api.getAIContextForFile(`${workspacePath}/${file.path}`);
            return ctx && ctx.sessions.length > 0 ? file.path : null;
          } catch {
            return null;
          }
        }),
      );
      for (const path of results) {
        if (path) paths.add(path);
      }
      if (!cancelled) setAiContextPaths(paths);
    })();

    return () => { cancelled = true; };
    // changedFilePathsKey captures file-list identity; workspacePath is the other dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedFilePathsKey, workspacePath]);

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
          const logResult = await api.jjLog(workspacePath, activeRevset);
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

  // --- File context menu actions ---

  const handleFileContextMenu = useCallback(
    (filePath: string, x: number, y: number) => {
      setFileContextMenu({ x, y, filePath });
    },
    [],
  );

  const handleOpenRestoreFromDialog = useCallback(() => {
    if (!fileContextMenu) return;
    setRestoreFromDialog({ filePath: fileContextMenu.filePath });
    setFileContextMenu(null);
  }, [fileContextMenu]);

  const handleRestore = useCallback(
    async (sourceRevision: string) => {
      if (!restoreFromDialog || !selectedChangeId) return;
      const changeId = selectedChangeId;
      const result = await api.jjRestore(
        workspacePath,
        changeId,
        sourceRevision,
        restoreFromDialog.filePath,
      );
      if (result.success) {
        setToast({
          message: `Restored ${restoreFromDialog.filePath} from ${sourceRevision}`,
          type: "success",
        });
        // Reload log, then re-select the same revision and refresh its files
        await loadLog();
        setSelectedChangeId(changeId);
        try {
          const files = await api.jjGetChangedFiles(workspacePath, changeId);
          setChangedFiles(files);
          setSelectedFilePath(null);
          setDiffData(null);
        } catch {
          // Ignore — effect will pick it up
        }
      } else {
        setToast({
          message: result.error ?? "Restore failed",
          type: "error",
        });
      }
      setRestoreFromDialog(null);
    },
    [workspacePath, selectedChangeId, restoreFromDialog, loadLog],
  );

  // --- Preset / revset handlers ---

  const handlePresetChange = useCallback(
    (preset: JJPreset) => {
      setActivePreset(preset);
      setRevsetError(null);
      setSelectedFilePath(null);
      setDiffData(null);
      setSelectedChangeId(null);

      if (preset !== "custom") {
        const config = PRESETS[preset];
        setActiveRevset(config.revset);
        if (config.isRange) {
          const bounds = parseRevsetBounds(config.revset);
          if (bounds) setRangeBounds(bounds);
          setJJViewMode("range");
        } else {
          setJJViewMode("single");
          setChangedFiles([]);
        }
      }
      // For "custom", wait for the user to submit a revset
    },
    [],
  );

  const handleCustomRevsetSubmit = useCallback((value: string) => {
    if (!value) return;
    setRevsetError(null);
    setActiveRevset(value);
    setSelectedChangeId(null);
    setSelectedFilePath(null);
    setDiffData(null);

    const bounds = parseRevsetBounds(value);
    if (bounds) {
      setRangeBounds(bounds);
      setJJViewMode("range");
    } else {
      setJJViewMode("single");
      setChangedFiles([]);
    }
  }, []);

  const handleShowRange = useCallback(() => {
    setJJViewMode("range");
    setSelectedChangeId(null);
    setSelectedFilePath(null);
    setDiffData(null);
    // Reload range files
    (async () => {
      try {
        const files = await api.jjGetRangeChangedFiles(
          workspacePath,
          rangeBounds.from,
          rangeBounds.to,
        );
        setChangedFiles(files);
      } catch {
        // Range files failed
      }
    })();
  }, [workspacePath, rangeBounds]);

  const handleSelectRevision = useCallback((changeId: string) => {
    setSelectedChangeId(changeId);
    // Only switch to single mode if we're in a range-mode preset
    if (jjViewMode === "range") {
      setJJViewMode("single");
    }
    setSelectedFilePath(null);
    setDiffData(null);
  }, [jjViewMode]);

  // Divider drag for left panel resize
  const dividerDragRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const cleanupDividerDrag = useCallback(() => {
    if (dividerDragRef.current) {
      document.removeEventListener("mousemove", dividerDragRef.current.move);
      document.removeEventListener("mouseup", dividerDragRef.current.up);
      dividerDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupDividerDrag();
    };
  }, [cleanupDividerDrag]);

  const handleDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftPanelWidth;

      const move = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setLeftPanelWidth(Math.max(200, Math.min(500, startWidth + delta)));
      };
      const up = () => cleanupDividerDrag();

      dividerDragRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [leftPanelWidth, cleanupDividerDrag],
  );

  // File list divider drag
  const fileListDividerDragRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const cleanupFileListDividerDrag = useCallback(() => {
    if (fileListDividerDragRef.current) {
      document.removeEventListener("mousemove", fileListDividerDragRef.current.move);
      document.removeEventListener("mouseup", fileListDividerDragRef.current.up);
      fileListDividerDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupFileListDividerDrag();
    };
  }, [cleanupFileListDividerDrag]);

  const handleFileListDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = fileListWidth;

      const move = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setFileListWidth(Math.max(120, Math.min(400, startWidth + delta)));
      };
      const up = () => cleanupFileListDividerDrag();

      fileListDividerDragRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [fileListWidth, cleanupFileListDividerDrag],
  );

  // AI panel divider drag
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
      const container = (e.target as HTMLElement).closest("[data-jj-content-panel]");
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
    if (!monacoSelection || !selectedFilePath) return;
    const fullPath = `${workspacePath}/${selectedFilePath}`;
    askClaudeAboutSelection(monacoSelection.text, fullPath, monacoSelection.lineNumber);
    setMonacoSelection(null);
    setViewMode(workspacePath, ViewMode.Terminal);
  }, [monacoSelection, selectedFilePath, workspacePath, setViewMode]);

  // Clear selection when switching files
  useEffect(() => {
    setMonacoSelection(null);
  }, [selectedFilePath]);

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

        {/* Preset selector */}
        <JJPresetSelector
          preset={activePreset}
          customRevset={activeRevset}
          error={revsetError}
          onPresetChange={handlePresetChange}
          onCustomSubmit={handleCustomRevsetSubmit}
        />

        {/* Revision list (scrollable) */}
        <div className="flex-1 min-h-0">
          <JJRevisionLog
            revisions={revisions}
            selectedChangeId={selectedChangeId}
            currentChangeId={currentChangeId}
            onSelectRevision={handleSelectRevision}
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

      {/* Right panel — range header or change detail + files sidebar + diff + AI context */}
      <div className="flex-1 h-full min-w-0 flex flex-col">
        {jjViewMode === "range" || selectedRevision ? (
          <>
            {/* Top: range header or change detail */}
            <div
              className="flex-shrink-0"
              style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
            >
              {jjViewMode === "range" ? (
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{ backgroundColor: "var(--ctp-mantle)" }}
                >
                  <span
                    className="text-xs font-mono"
                    style={{ color: "var(--ctp-mauve)" }}
                  >
                    {rangeBounds.from}
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--ctp-overlay0)" }}
                  >
                    ..
                  </span>
                  <span
                    className="text-xs font-mono"
                    style={{ color: "var(--ctp-mauve)" }}
                  >
                    {rangeBounds.to}
                  </span>
                  <span
                    className="text-[10px] ml-2"
                    style={{ color: "var(--ctp-subtext0)" }}
                  >
                    {revisions.length} revision{revisions.length !== 1 ? "s" : ""}
                  </span>
                </div>
              ) : (
                <JJChangeDetail
                  revision={selectedRevision!}
                  onDescriptionSave={handleDescriptionSave}
                  onAbandon={handleAbandon}
                  isSaving={isSaving}
                />
              )}
            </div>

            {/* Show Range button when in single mode within a range-capable preset */}
            {jjViewMode === "single" && (activePreset === "since-branch" || (activePreset === "custom" && parseRevsetBounds(activeRevset) !== null)) && (
              <div
                className="flex-shrink-0 px-3 py-1"
                style={{
                  backgroundColor: "var(--ctp-mantle)",
                  borderBottom: "1px solid var(--ctp-surface0)",
                }}
              >
                <button
                  className="text-[10px] hover:underline"
                  style={{ color: "var(--ctp-mauve)" }}
                  onClick={handleShowRange}
                >
                  Show Range
                </button>
              </div>
            )}

            {/* Content area: files sidebar + diff + AI panel */}
            <div className="flex-1 min-h-0 flex flex-col" data-jj-content-panel>
              {/* Files + Diff row */}
              <div style={{ flex: `${1 - aiPanelRatio}` }} className="min-h-0 flex">
                {/* File list sidebar */}
                <div
                  className="flex-shrink-0 h-full flex flex-col"
                  style={{ width: fileListWidth, borderRight: "1px solid var(--ctp-surface0)" }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
                    style={{
                      backgroundColor: "var(--ctp-mantle)",
                      borderBottom: "1px solid var(--ctp-surface0)",
                    }}
                  >
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--ctp-text)" }}
                    >
                      Files ({changedFiles.length})
                    </span>
                  </div>
                  <div className="overflow-y-auto flex-1 min-h-0">
                    {changedFiles.length === 0 ? (
                      <div
                        className="px-3 py-2 text-[10px]"
                        style={{ color: "var(--ctp-overlay0)" }}
                      >
                        No changed files
                      </div>
                    ) : (
                      changedFiles.map((file) => {
                        const fileName = file.path.split("/").pop() ?? file.path;
                        const isSelected = selectedFilePath === file.path;

                        return (
                          <div
                            key={file.path}
                            title={file.path}
                            className="flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs"
                            style={{
                              backgroundColor: isSelected
                                ? "var(--ctp-surface0)"
                                : "transparent",
                            }}
                            onClick={() => setSelectedFilePath(file.path)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleFileContextMenu(file.path, e.clientX, e.clientY);
                            }}
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
                            <span
                              className="font-mono font-bold flex-shrink-0"
                              style={{
                                color:
                                  ({
                                    modified: "var(--ctp-blue)",
                                    added: "var(--ctp-green)",
                                    deleted: "var(--ctp-red)",
                                    renamed: "var(--ctp-peach)",
                                    copied: "var(--ctp-peach)",
                                    untracked: "var(--ctp-yellow)",
                                  } as Record<string, string>)[file.changeType] ?? "var(--ctp-text)",
                                minWidth: 12,
                              }}
                            >
                              {({ modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "?" } as Record<string, string>)[file.changeType] ?? "?"}
                            </span>
                            <span className="truncate" style={{ color: "var(--ctp-text)" }}>
                              {fileName}
                            </span>
                            {aiContextPaths.has(file.path) && (
                              <span
                                className="text-[9px] font-bold px-1 py-px rounded-full flex-shrink-0"
                                style={{
                                  background: "var(--ctp-mauve)",
                                  color: "var(--ctp-base)",
                                }}
                                title="Claude has edited this file"
                              >
                                AI
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* File list resizable divider */}
                <div
                  className="flex-shrink-0 cursor-col-resize hover:opacity-100 transition-opacity"
                  style={{
                    width: 3,
                    backgroundColor: "var(--ctp-surface0)",
                    opacity: 0.6,
                  }}
                  onMouseDown={handleFileListDividerDrag}
                />

                {/* Diff viewer */}
                <div className="flex-1 min-w-0 flex flex-col">
                  {selectedFilePath && diffData ? (
                    <>
                      <VCSDiffHeader
                        filePath={selectedFilePath}
                        displayMode={displayMode}
                        onDisplayModeChange={setDisplayMode}
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
                      {changedFiles.length === 0 ? (
                        <>
                          <span className="text-sm">
                            {jjViewMode === "single" && selectedRevision?.isEmpty
                              ? "Empty Change"
                              : "No Changed Files"}
                          </span>
                          <span className="text-xs opacity-60">
                            {jjViewMode === "single" && selectedRevision?.isEmpty
                              ? "This change has no modifications."
                              : "No files were changed in this range."}
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

      {/* File context menu */}
      {fileContextMenu && (
        <JJFileContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          filePath={fileContextMenu.filePath}
          onRestoreFrom={handleOpenRestoreFromDialog}
          onDismiss={() => setFileContextMenu(null)}
        />
      )}

      {/* Restore from dialog */}
      {restoreFromDialog && selectedChangeId && (
        <JJRestoreFromDialog
          workspacePath={workspacePath}
          targetRevision={selectedChangeId}
          filePath={restoreFromDialog.filePath}
          revisions={revisions}
          bookmarks={bookmarks}
          onConfirm={handleRestore}
          onCancel={() => setRestoreFromDialog(null)}
        />
      )}
    </div>
  );
}
