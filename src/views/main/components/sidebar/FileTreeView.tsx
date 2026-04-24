// File tree view — unified 3-level tree: repo → workspace → files.
// Phase 1. Top levels (repo, workspace) render synchronously from existing
// store data. File/folder levels are lazy-loaded via api.listDir (see
// useExpandEffects) and pushed into fileTreeEntries.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { openFileInWorkspace, openFileInSplit } from "../../state/actions";
import { allPanes, findPane } from "../../models/pane-node";
import { OverlayWrapper } from "../../state/useOverlay";
import { fuzzyMatch } from "../palette/fuzzy-match";
import { FileTreeNode, FILE_TREE_DRAG_MIME, type FileTreeDragData, type TreeNode } from "./FileTreeNode";
import { effectiveWorkspaceStatus, statusDotColor } from "./workspaceIndicators";
import { VCSType, WorkspaceStatus } from "../../../../shared/ipc-types";

function fileExtKey(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

export function FileTreeView() {
  const repos = useStore((s) => s.repos);
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);
  const expandedRepos = useStore((s) => s.fileTreeExpandedRepos);
  const expandedWorkspaces = useStore((s) => s.fileTreeExpandedWorkspaces);
  const expandedDirs = useStore((s) => s.fileTreeExpandedDirs);
  const entries = useStore((s) => s.fileTreeEntries);
  const loading = useStore((s) => s.fileTreeLoading);
  const errorMap = useStore((s) => s.fileTreeError);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const paneTrees = useStore((s) => s.paneTrees);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const activeSidebarView = useStore((s) => s.activeSidebarView);
  const setFileTreeExpanded = useStore((s) => s.setFileTreeExpanded);
  const invalidateFileTreeDir = useStore((s) => s.invalidateFileTreeDir);
  const cursor = useStore((s) => s.fileTreeCursor);
  const setCursor = useStore((s) => s.setFileTreeCursor);
  const showHidden = useStore((s) => s.fileTreeShowHidden);
  const setShowHidden = useStore((s) => s.setFileTreeShowHidden);
  const autoReveal = useStore((s) => s.fileTreeAutoReveal);
  const setAutoReveal = useStore((s) => s.setFileTreeAutoReveal);
  const vcsStatusMap = useStore((s) => s.fileTreeVcsStatus);
  const setFileTreeVcsStatus = useStore((s) => s.setFileTreeVcsStatus);
  const sidebarInfoMap = useStore((s) => s.sidebarInfo);
  const workspaceActivity = useStore((s) => s.workspaceActivity);

  // Local (ephemeral) filter input — not persisted. Empty string = no filter.
  const [filterQuery, setFilterQuery] = useState("");

  // Context menu state — set on right-click, cleared by menu click or outside click.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);

  // Revert-flow state. `revertConfirm` opens the confirmation dialog;
  // `revertToast` briefly surfaces success/error after the operation.
  const [revertConfirm, setRevertConfirm] = useState<{ node: TreeNode; vcsType: VCSType } | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertToast, setRevertToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const isFilesActive = sidebarVisible && activeSidebarView === "files";
  const setFileTreeLoading = useStore((s) => s.setFileTreeLoading);
  const setFileTreeEntries = useStore((s) => s.setFileTreeEntries);
  const setFileTreeError = useStore((s) => s.setFileTreeError);

  // View-visibility lifecycle for recursive fs.watch.
  //
  // Watchers are expensive to leave running when the user isn't looking at
  // the tree, so we only keep them alive while the Files view is the active
  // sidebar content. Toggling in also invalidates every expanded-dir cache
  // entry, forcing a refetch — this catches filesystem changes that happened
  // while we weren't watching.
  useEffect(() => {
    if (!isFilesActive) {
      // Will only be a no-op if we hadn't started any watchers, which is fine.
      api.unwatchAllDirectoryTrees().catch(() => {});
      return;
    }

    const wsPaths = Object.keys(expandedWorkspaces);
    for (const wsPath of wsPaths) {
      api.watchDirectoryTree(wsPath).then((res: { ok: boolean; errorKind?: "not_found" | "other" } | undefined) => {
        if (res?.errorKind === "not_found") {
          setFileTreeExpanded("workspace", wsPath, false);
        }
      }).catch(() => {});
    }

    // Every expanded dir cached entry may be stale if we were unmounted
    // during a filesystem change. Invalidate; the entries-fetch effect
    // below will refetch whatever is still expanded.
    for (const dirPath of Object.keys(expandedDirs)) {
      invalidateFileTreeDir(dirPath);
    }
    for (const wsPath of wsPaths) {
      invalidateFileTreeDir(wsPath);
    }

    return () => {
      api.unwatchAllDirectoryTrees().catch(() => {});
    };
    // Intentionally: we do NOT depend on expandedDirs / expandedWorkspaces
    // here — the per-workspace watcher effect below handles those, and
    // rerunning this effect would wipe the cache on every expand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFilesActive]);

  // Per-workspace watcher registration/deregistration while Files view is
  // active. Fires only the delta for expanded workspaces.
  useEffect(() => {
    if (!isFilesActive) return;
    const wsPaths = Object.keys(expandedWorkspaces);
    for (const wsPath of wsPaths) {
      api.watchDirectoryTree(wsPath).then((res: { ok: boolean; errorKind?: "not_found" | "other" } | undefined) => {
        if (res?.errorKind === "not_found") {
          setFileTreeExpanded("workspace", wsPath, false);
        }
      }).catch(() => {});
    }
    return () => {
      // When the set of expanded workspaces shrinks, unwatch the removed
      // ones. Easiest: capture the current set and on cleanup unwatch any
      // that are gone. In practice the view-visibility effect also calls
      // unwatchAll on deactivate, so this cleanup is best-effort.
      for (const wsPath of wsPaths) {
        const stillExpanded = !!useStore.getState().fileTreeExpandedWorkspaces[wsPath];
        if (!stillExpanded) {
          api.unwatchDirectoryTree(wsPath).catch(() => {});
        }
      }
    };
  }, [isFilesActive, expandedWorkspaces]);

  // Index of all workspace paths, used to look up the owning workspace for any
  // path inside the tree. Longest-prefix-wins.
  const allWorkspacePaths = useMemo<string[]>(() => {
    const s: string[] = [];
    for (const list of Object.values(workspacesByRepo)) {
      for (const ws of list) s.push(ws.path);
    }
    return s.sort((a, b) => b.length - a.length);
  }, [workspacesByRepo]);

  const findWorkspaceForPath = useCallback(
    (path: string): string | undefined => {
      for (const wsPath of allWorkspacePaths) {
        if (path === wsPath || path.startsWith(wsPath + "/")) return wsPath;
      }
      return undefined;
    },
    [allWorkspacePaths],
  );

  // Fetch listDir for any newly-expanded workspace/dir whose contents aren't
  // already cached. `entries[path]` is authoritative — once populated, don't
  // refetch until an fs.watch event invalidates it.
  //
  // IMPORTANT: dependencies are intentionally limited to the expansion sets.
  // Including `entries` / `loading` would cause this effect to re-run every
  // time setFileTreeLoading fires, and the cleanup would set cancelled=true
  // *before* the in-flight listDir resolved — leaving nodes stuck on
  // "Loading…" forever. Reading the current cache lazily from the store
  // avoids the stale-closure problem without adding those deps.
  useEffect(() => {
    const snapshot = useStore.getState();
    const needed: string[] = [];
    for (const path of Object.keys(expandedWorkspaces)) {
      if (!(path in snapshot.fileTreeEntries) && !snapshot.fileTreeLoading[path]) {
        needed.push(path);
      }
    }
    for (const path of Object.keys(expandedDirs)) {
      if (!(path in snapshot.fileTreeEntries) && !snapshot.fileTreeLoading[path]) {
        needed.push(path);
      }
    }
    if (needed.length === 0) return;

    let cancelled = false;
    for (const path of needed) {
      setFileTreeLoading(path, true);
      const wsPath = findWorkspaceForPath(path);
      api.listDir(path, wsPath).then(
        (res: any) => {
          if (cancelled) return;
          if (res?.ok && Array.isArray(res.entries)) {
            setFileTreeEntries(path, res.entries);
          } else {
            setFileTreeError(path, res?.error ?? "Failed to list directory");
            setFileTreeLoading(path, false);
          }
        },
        (err: any) => {
          if (cancelled) return;
          setFileTreeError(path, err?.message ?? "RPC error");
          setFileTreeLoading(path, false);
        },
      );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedWorkspaces, expandedDirs]);

  // Fetch VCS status for every expanded workspace so we can decorate the
  // tree with M/A/U badges. Refreshes when expansion set changes OR when
  // the watcher fires (directoryChanged invalidates fileTreeEntries which
  // is how we detect external edits). Silently swallows errors — the tree
  // still works without badges.
  useEffect(() => {
    if (!isFilesActive) return;
    const wsPaths = Object.keys(expandedWorkspaces);
    let cancelled = false;
    for (const wsPath of wsPaths) {
      api.getVCSStatus(wsPath).then(
        (status: any) => {
          if (cancelled) return;
          if (status) setFileTreeVcsStatus(wsPath, status);
        },
        () => { /* swallow */ },
      );
    }
    return () => { cancelled = true; };
  }, [isFilesActive, expandedWorkspaces, entries, setFileTreeVcsStatus]);

  // Absolute-file-path → VCS badge letter. Built from all expanded workspace
  // statuses. Prefer the most recent state: modified > added > untracked >
  // renamed > deleted (the map construction order handles precedence).
  const vcsBadgeByPath = useMemo<Record<string, "M" | "A" | "D" | "R" | "U">>(() => {
    const result: Record<string, "M" | "A" | "D" | "R" | "U"> = {};
    for (const [wsPath, status] of Object.entries(vcsStatusMap)) {
      if (!status?.files) continue;
      for (const f of status.files) {
        const abs = f.path.startsWith("/") ? f.path : `${wsPath}/${f.path}`;
        const letter: "M" | "A" | "D" | "R" | "U" = (
          f.changeType === "modified" ? "M"
          : f.changeType === "added" ? "A"
          : f.changeType === "deleted" ? "D"
          : f.changeType === "renamed" || f.changeType === "copied" ? "R"
          : "U"
        );
        result[abs] = letter;
      }
    }
    return result;
  }, [vcsStatusMap]);

  // Currently focused file path — derived from the focused workspace's
  // focused pane's selected tab. Used to highlight the matching row in the tree.
  const activeFilePath = useMemo<string | null>(() => {
    if (!selectedWorkspacePath) return null;
    const tree = paneTrees[selectedWorkspacePath];
    if (!tree) return null;
    const panes = allPanes(tree);
    const pane = focusedPaneId
      ? findPane(tree, focusedPaneId) ?? panes[0]
      : panes[0];
    if (!pane) return null;
    const tab = pane.tabs.find((t) => t.id === pane.selectedTabId) ?? pane.tabs[0];
    if (!tab) return null;
    return tab.editorFilePath ?? tab.markdownFilePath ?? null;
  }, [selectedWorkspacePath, paneTrees, focusedPaneId]);

  const visibleNodes = useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = [];

    // Collect workspaces sorted so "default" appears first (matches existing
    // Workspaces view convention).
    const wsSort = (a: { name: string }, b: { name: string }) =>
      a.name === "default" ? -1 : b.name === "default" ? 1 : a.name.localeCompare(b.name);

    for (const repo of repos) {
      const repoExpanded = !!expandedRepos[repo.id];
      out.push({
        id: `repo:${repo.id}`,
        kind: "repo",
        depth: 0,
        label: repo.name,
        expandable: true,
        isExpanded: repoExpanded,
        repoId: repo.id,
      });

      if (!repoExpanded) continue;

      const workspaces = [...(workspacesByRepo[repo.id] ?? [])].sort(wsSort);
      for (const ws of workspaces) {
        const wsExpanded = !!expandedWorkspaces[ws.path];
        const effectiveStatus = effectiveWorkspaceStatus(ws.status, workspaceActivity[ws.path]);
        out.push({
          id: `workspace:${ws.path}`,
          kind: "workspace",
          depth: 1,
          label: ws.name,
          expandable: true,
          isExpanded: wsExpanded,
          workspacePath: ws.path,
          repoId: repo.id,
          isFocusedWorkspace: ws.path === selectedWorkspacePath,
          branchHealth: sidebarInfoMap[ws.path]?.branchHealth,
          claudeDotColor: statusDotColor[effectiveStatus] ?? "var(--ctp-overlay0)",
          claudeDotIdle: effectiveStatus === WorkspaceStatus.Idle,
        });

        if (!wsExpanded) continue;
        pushDirChildren(out, ws.path, ws.path, 2);
      }
    }

    return out;

    function pushDirChildren(
      acc: TreeNode[],
      dirPath: string,
      workspacePath: string,
      depth: number,
    ): void {
      const dirEntries = entries[dirPath];
      if (!dirEntries) {
        const err = errorMap[dirPath];
        if (err) {
          acc.push({
            id: `err:${dirPath}`,
            kind: "file",
            depth,
            label: err,
            expandable: false,
            isExpanded: false,
            workspacePath,
          });
        } else if (loading[dirPath]) {
          acc.push({
            id: `loading:${dirPath}`,
            kind: "file",
            depth,
            label: "Loading…",
            expandable: false,
            isExpanded: false,
            workspacePath,
          });
        }
        return;
      }
      if (dirEntries.length === 0) {
        acc.push({
          id: `empty:${dirPath}`,
          kind: "file",
          depth,
          label: "(empty)",
          expandable: false,
          isExpanded: false,
          workspacePath,
        });
        return;
      }
      for (const entry of dirEntries) {
        const isDotfile = entry.name.startsWith(".");
        if (entry.isDirectory) {
          const isExpanded = !!expandedDirs[entry.fullPath];
          acc.push({
            id: `dir:${entry.fullPath}`,
            kind: "dir",
            depth,
            label: entry.name,
            expandable: true,
            isExpanded,
            fullPath: entry.fullPath,
            workspacePath,
            isIgnored: entry.isIgnored,
            isDotfile,
          });
          if (isExpanded) {
            pushDirChildren(acc, entry.fullPath, workspacePath, depth + 1);
          }
        } else {
          acc.push({
            id: `file:${entry.fullPath}`,
            kind: "file",
            depth,
            label: entry.name,
            expandable: false,
            isExpanded: false,
            fullPath: entry.fullPath,
            workspacePath,
            fileExtKey: fileExtKey(entry.name),
            isActiveFile: entry.fullPath === activeFilePath,
            isIgnored: entry.isIgnored,
            isDotfile,
            vcsBadge: vcsBadgeByPath[entry.fullPath],
          });
        }
      }
    }
  }, [
    repos,
    workspacesByRepo,
    expandedRepos,
    expandedWorkspaces,
    expandedDirs,
    entries,
    loading,
    errorMap,
    selectedWorkspacePath,
    activeFilePath,
    vcsBadgeByPath,
    sidebarInfoMap,
    workspaceActivity,
  ]);

  // Apply the filter box: keep only rows whose label fuzzy-matches the query,
  // plus their ancestor rows so the match can be seen in context. Empty
  // filter returns the tree unchanged.
  const filteredNodes = useMemo<TreeNode[]>(() => {
    if (!filterQuery.trim()) return visibleNodes;
    const q = filterQuery.trim();
    const keep = new Set<number>();
    for (let i = 0; i < visibleNodes.length; i++) {
      if (!fuzzyMatch(q, visibleNodes[i]!.label)) continue;
      keep.add(i);
      // Walk backward, collecting each ancestor (strictly shallower depth).
      let targetDepth = visibleNodes[i]!.depth - 1;
      for (let j = i - 1; j >= 0 && targetDepth >= 0; j--) {
        if (visibleNodes[j]!.depth === targetDepth) {
          keep.add(j);
          targetDepth--;
        }
      }
    }
    return visibleNodes.filter((_, i) => keep.has(i));
  }, [visibleNodes, filterQuery]);

  const toggleExpanded = useCallback((node: TreeNode, expanded?: boolean) => {
    const target = expanded ?? !node.isExpanded;
    if (node.kind === "repo") setFileTreeExpanded("repo", node.repoId!, target);
    else if (node.kind === "workspace") setFileTreeExpanded("workspace", node.workspacePath!, target);
    else if (node.kind === "dir") setFileTreeExpanded("dir", node.fullPath!, target);
  }, [setFileTreeExpanded]);

  const openFileNode = useCallback((node: TreeNode) => {
    if (node.kind === "file" && node.workspacePath && node.fullPath) {
      openFileInWorkspace(node.workspacePath, node.fullPath);
    }
  }, []);

  const handleClick = useCallback((node: TreeNode) => {
    setCursor(node.id);
    if (node.kind === "file") openFileNode(node);
    else toggleExpanded(node);
  }, [setCursor, openFileNode, toggleExpanded]);

  const handleContextMenu = useCallback((node: TreeNode, event: React.MouseEvent) => {
    if (!node.fullPath) return; // no actions for repo rows
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Find the VCS type (Git vs JJ) for the repo that owns a given workspace
  // path. Returns null if the workspace isn't in any known repo — in that case
  // we don't know how to revert, so the menu item is suppressed.
  const vcsTypeForWorkspace = useCallback(
    (wsPath: string): VCSType | null => {
      for (const repo of repos) {
        const workspaces = workspacesByRepo[repo.id] ?? [];
        if (workspaces.some((w) => w.path === wsPath)) return repo.vcsType;
      }
      return null;
    },
    [repos, workspacesByRepo],
  );

  // Revert the file back to its last-committed state. For Git this is
  // `git checkout HEAD` (plus unstage/delete-untracked semantics handled by
  // vcsRevertFiles on the backend). For JJ, the working-copy change is @, so
  // "last change" means restoring the file from @- into @.
  const performRevert = useCallback(async (node: TreeNode, vcsType: VCSType) => {
    if (!node.workspacePath || !node.fullPath) return;
    const wsPath = node.workspacePath;
    const relPath = node.fullPath.startsWith(wsPath + "/")
      ? node.fullPath.slice(wsPath.length + 1)
      : node.fullPath;

    setRevertBusy(true);
    try {
      if (vcsType === VCSType.JJ) {
        const res: any = await api.jjRestore(wsPath, "@", "@-", relPath);
        if (!res?.success) {
          setRevertToast({ message: res?.error ?? "Revert failed", type: "error" });
          return;
        }
      } else {
        const res: any = await api.vcsRevertFiles(wsPath, [relPath]);
        if (!res?.success) {
          setRevertToast({ message: res?.error ?? "Revert failed", type: "error" });
          return;
        }
      }

      // Refresh VCS status so the badge clears, and invalidate the containing
      // directory so an untracked-and-deleted file disappears from the tree.
      try {
        const status = await api.getVCSStatus(wsPath);
        if (status) setFileTreeVcsStatus(wsPath, status);
      } catch { /* badge refresh is best-effort */ }
      const slash = node.fullPath.lastIndexOf("/");
      if (slash > 0) invalidateFileTreeDir(node.fullPath.slice(0, slash));

      setRevertToast({ message: `Reverted ${relPath}`, type: "success" });
    } catch (err: any) {
      setRevertToast({ message: err?.message ?? "Revert failed", type: "error" });
    } finally {
      setRevertBusy(false);
    }
  }, [setFileTreeVcsStatus, invalidateFileTreeDir]);

  // Auto-dismiss the revert toast after a short delay.
  useEffect(() => {
    if (!revertToast) return;
    const id = setTimeout(() => setRevertToast(null), 2500);
    return () => clearTimeout(id);
  }, [revertToast]);

  const handleDragStart = useCallback((node: TreeNode, event: React.DragEvent) => {
    if (node.kind !== "file" || !node.fullPath || !node.workspacePath) return;
    const payload: FileTreeDragData = {
      workspacePath: node.workspacePath,
      filePath: node.fullPath,
    };
    try {
      event.dataTransfer.setData(FILE_TREE_DRAG_MIME, JSON.stringify(payload));
      // Also set plain-text so other drop targets (e.g. a terminal) can
      // receive the path as a simple string they can insert verbatim.
      event.dataTransfer.setData("text/plain", node.fullPath);
      event.dataTransfer.effectAllowed = "copyMove";
    } catch {
      /* dataTransfer may be unavailable in some edge cases */
    }
    useStore.getState().setFileTreeDragActive(true);
  }, []);

  const handleDragEnd = useCallback(() => {
    useStore.getState().setFileTreeDragActive(false);
  }, []);

  // Reveal the currently-open file in the tree: expand its owning repo,
  // workspace, and every ancestor directory, then move the cursor to it.
  // If there's no active file (no tab selected), no-op.
  //
  // `preserveFilter` skips clearing the filter input — used by auto-reveal so
  // the tree doesn't wipe what the user is typing when the active file changes.
  const revealActiveFile = useCallback((preserveFilter = false) => {
    if (!activeFilePath) return;
    const wsPath = findWorkspaceForPath(activeFilePath);
    if (!wsPath) return;

    // Find the repo that owns this workspace so we can expand it too.
    const repoForWs = repos.find((r) =>
      (workspacesByRepo[r.id] ?? []).some((w) => w.path === wsPath),
    );
    if (repoForWs) setFileTreeExpanded("repo", repoForWs.id, true);

    setFileTreeExpanded("workspace", wsPath, true);

    // Expand each intermediate directory between wsPath and the file.
    const rel = activeFilePath.slice(wsPath.length + 1); // drop leading "/"
    const segments = rel.split("/");
    let cursor = wsPath;
    for (let i = 0; i < segments.length - 1; i++) {
      cursor = `${cursor}/${segments[i]}`;
      setFileTreeExpanded("dir", cursor, true);
    }

    setCursor(`file:${activeFilePath}`);
    if (!preserveFilter) setFilterQuery("");
  }, [
    activeFilePath,
    findWorkspaceForPath,
    repos,
    workspacesByRepo,
    setFileTreeExpanded,
    setCursor,
  ]);

  // Auto-reveal: when enabled, follow the active Monaco file as it changes.
  // Preserves the filter input so typing in the tree filter isn't interrupted
  // by a focus change in another pane.
  useEffect(() => {
    if (!autoReveal) return;
    revealActiveFile(true);
  }, [autoReveal, activeFilePath, revealActiveFile]);

  // --- Keyboard navigation ---
  // The cursor lives on the container (single tabIndex=0). The visible-rows
  // array is the ordered flat list — cursor operations are just index math.
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRowRef = useRef<HTMLDivElement>(null);

  // Find the parent of a given node in the visibleNodes array: the closest
  // preceding node with depth = target.depth - 1. Used by ArrowLeft.
  const findParentIdx = (idx: number): number => {
    const targetDepth = visibleNodes[idx]!.depth - 1;
    if (targetDepth < 0) return -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (visibleNodes[i]!.depth === targetDepth) return i;
    }
    return -1;
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Navigate using the currently-rendered list (filtered when a query is
    // active), so the cursor always lands on a row the user can see.
    const rows = filteredNodes;
    if (rows.length === 0) return;
    const cursorIdx = cursor ? rows.findIndex((n) => n.id === cursor) : -1;

    if (cursorIdx < 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setCursor(rows[0]!.id);
      return;
    }

    const current = cursorIdx >= 0 ? rows[cursorIdx]! : null;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (cursorIdx < rows.length - 1) setCursor(rows[cursorIdx + 1]!.id);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (cursorIdx > 0) setCursor(rows[cursorIdx - 1]!.id);
        return;
      case "ArrowRight":
        e.preventDefault();
        if (!current) return;
        if (current.expandable && !current.isExpanded) {
          toggleExpanded(current, true);
        } else if (current.expandable && current.isExpanded) {
          if (cursorIdx + 1 < rows.length) setCursor(rows[cursorIdx + 1]!.id);
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (!current) return;
        if (current.expandable && current.isExpanded) {
          toggleExpanded(current, false);
        } else {
          // Parent lookup uses the rendered rows so the arrow-left jump
          // respects the current (possibly filtered) view.
          const targetDepth = current.depth - 1;
          if (targetDepth < 0) return;
          for (let j = cursorIdx - 1; j >= 0; j--) {
            if (rows[j]!.depth === targetDepth) {
              setCursor(rows[j]!.id);
              break;
            }
          }
        }
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!current) return;
        if (current.kind === "file") openFileNode(current);
        else toggleExpanded(current);
        return;
      case "Home":
        e.preventDefault();
        setCursor(rows[0]!.id);
        return;
      case "End":
        e.preventDefault();
        setCursor(rows[rows.length - 1]!.id);
        return;
      case "Escape":
        if (filterQuery) {
          e.preventDefault();
          setFilterQuery("");
        }
        return;
    }
  }, [cursor, filteredNodes, filterQuery, setCursor, toggleExpanded, openFileNode]);

  // Keep the cursor row visible. useLayoutEffect so the scroll adjustment
  // runs in the same frame as the state change — no visible flicker.
  useLayoutEffect(() => {
    if (cursorRowRef.current) {
      cursorRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [cursor]);

  return (
    <div className="flex flex-col h-full bg-[var(--ctp-mantle)] select-none">
      <div
        className="px-3 py-2 text-[10px] uppercase tracking-wider flex-shrink-0 flex items-center justify-between gap-2"
        style={{
          color: "var(--ctp-overlay1)",
          borderBottom: "1px solid var(--ctp-surface0)",
          letterSpacing: "0.08em",
        }}
      >
        <span>Files</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Reveal active file"
            aria-label="Reveal active file"
            onClick={() => revealActiveFile()}
            disabled={!activeFilePath}
            className="p-1 rounded hover:bg-[var(--ctp-surface0)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 1a.5.5 0 0 1 .5.5v5.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 6.793V1.5A.5.5 0 0 1 8 1ZM2 11a.5.5 0 0 1 1 0v2a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 1 1 0v2A1.5 1.5 0 0 1 12.5 14.5h-9A1.5 1.5 0 0 1 2 13v-2Z" />
            </svg>
          </button>
          <button
            type="button"
            title={autoReveal ? "Auto-reveal active file: on" : "Auto-reveal active file: off"}
            aria-label="Toggle auto-reveal active file"
            aria-pressed={autoReveal}
            onClick={() => setAutoReveal(!autoReveal)}
            className="p-1 rounded hover:bg-[var(--ctp-surface0)] transition-colors"
            style={{ color: autoReveal ? "var(--ctp-blue)" : "var(--ctp-overlay0)" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M9.354 2.146a.5.5 0 0 0-.708.708L10.293 4.5H7a3.5 3.5 0 0 0 0 7h1a.5.5 0 0 0 0-1H7a2.5 2.5 0 0 1 0-5h3.293L8.646 7.146a.5.5 0 1 0 .708.708l2.5-2.5a.5.5 0 0 0 0-.708l-2.5-2.5ZM6.646 13.854a.5.5 0 0 0 .708-.708L5.707 11.5H9a3.5 3.5 0 0 0 0-7H8a.5.5 0 0 0 0 1h1a2.5 2.5 0 0 1 0 5H5.707l1.647-1.646a.5.5 0 1 0-.708-.708l-2.5 2.5a.5.5 0 0 0 0 .708l2.5 2.5Z" />
            </svg>
          </button>
          <button
            type="button"
            title={showHidden ? "Dim ignored files" : "Show ignored files at full opacity"}
            aria-pressed={showHidden}
            onClick={() => setShowHidden(!showHidden)}
            className="p-1 rounded hover:bg-[var(--ctp-surface0)] transition-colors"
            style={{ color: showHidden ? "var(--ctp-text)" : "var(--ctp-overlay0)" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              {showHidden ? (
                <path d="M8 2a7.5 7.5 0 0 0-6.93 4.66.5.5 0 0 0 0 .68A7.5 7.5 0 0 0 8 12a7.5 7.5 0 0 0 6.93-4.66.5.5 0 0 0 0-.68A7.5 7.5 0 0 0 8 2Zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5A1.5 1.5 0 1 0 8 8.5 1.5 1.5 0 0 0 8 5.5Z" />
              ) : (
                <path d="M3.13 1.34L14.66 12.87a.5.5 0 0 1-.7.7l-1.84-1.84A7.5 7.5 0 0 1 8 12a7.5 7.5 0 0 1-6.93-4.66.5.5 0 0 1 0-.68 7.46 7.46 0 0 1 2.7-3.13L2.42 2.05a.5.5 0 1 1 .7-.71ZM8 10a3 3 0 0 0 2.12-.88L9.05 8.06a1.5 1.5 0 0 1-2.1-2.1L5.87 4.88A3 3 0 0 0 8 10Z" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {/* Filter input */}
      <div className="px-2 py-1 flex-shrink-0 border-b border-[var(--ctp-surface0)]">
        <input
          type="text"
          placeholder="Filter…"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFilterQuery("");
          }}
          className="w-full text-[11px] px-2 py-1 rounded bg-[var(--ctp-surface0)] text-[var(--ctp-text)] placeholder:text-[var(--ctp-overlay0)] outline-none focus:bg-[var(--ctp-surface1)]"
        />
      </div>
      <div
        ref={containerRef}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 min-h-0 overflow-y-auto py-1 outline-none"
      >
        {repos.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-[var(--ctp-overlay0)]">
            No repositories. Switch to Workspaces to add one.
          </div>
        ) : filteredNodes.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-[var(--ctp-overlay0)]">
            No matches for &ldquo;{filterQuery}&rdquo;
          </div>
        ) : (
          filteredNodes.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              isCursor={node.id === cursor}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              rowRef={node.id === cursor ? cursorRowRef : undefined}
              showHiddenAtFullOpacity={showHidden}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          vcsType={
            contextMenu.node.workspacePath
              ? vcsTypeForWorkspace(contextMenu.node.workspacePath)
              : null
          }
          onRevertRequest={(node, vcsType) => {
            setRevertConfirm({ node, vcsType });
            setContextMenu(null);
          }}
          onClose={closeContextMenu}
        />
      )}

      {revertConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => !revertBusy && setRevertConfirm(null)}
          />
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
              Revert <strong>{revertConfirm.node.label}</strong> to the last committed
              state? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                disabled={revertBusy}
                className="px-3 py-1 text-xs rounded disabled:opacity-50"
                style={{ background: "var(--ctp-surface1)", color: "var(--ctp-text)" }}
                onClick={() => setRevertConfirm(null)}
              >
                Cancel
              </button>
              <button
                disabled={revertBusy}
                className="px-3 py-1 text-xs rounded font-semibold disabled:opacity-50"
                style={{ background: "var(--ctp-red)", color: "var(--ctp-base)" }}
                onClick={async () => {
                  const target = revertConfirm;
                  await performRevert(target.node, target.vcsType);
                  setRevertConfirm(null);
                }}
              >
                {revertBusy ? "Reverting…" : "Revert"}
              </button>
            </div>
          </div>
        </div>
      )}

      {revertToast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-[210]"
          style={{
            backgroundColor:
              revertToast.type === "success" ? "var(--ctp-green)" : "var(--ctp-red)",
            color: "var(--ctp-base)",
          }}
        >
          {revertToast.message}
        </div>
      )}
    </div>
  );
}

// --- Context menu ---

interface ContextMenuProps {
  x: number;
  y: number;
  node: TreeNode;
  vcsType: VCSType | null;
  onRevertRequest: (node: TreeNode, vcsType: VCSType) => void;
  onClose: () => void;
}

function FileTreeContextMenu({ x, y, node, vcsType, onRevertRequest, onClose }: ContextMenuProps) {
  const isFile = node.kind === "file";
  const isDir = node.kind === "dir";
  const isWorkspace = node.kind === "workspace";
  const path = node.fullPath;
  const workspacePath = node.workspacePath;
  // Revert is offered for files that the VCS reports as changed relative to
  // the last commit. We don't offer revert on directories or workspace rows.
  const canRevert = isFile && !!node.vcsBadge && !!vcsType && !!workspacePath;

  // Workspace-rooted relative path for "Copy Relative Path". Falls back to
  // the basename if workspacePath isn't available (e.g. a dir outside a
  // known workspace — shouldn't really happen in practice).
  const relativePath = useMemo(() => {
    if (!path) return "";
    if (isWorkspace) return node.label;
    if (workspacePath && path.startsWith(workspacePath + "/")) {
      return path.slice(workspacePath.length + 1);
    }
    return path.split("/").pop() ?? path;
  }, [path, workspacePath, isWorkspace, node.label]);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  if (!path) return null;

  return (
    <OverlayWrapper>
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        role="menu"
        className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] py-1 shadow-xl"
        style={{ left: x, top: y }}
      >
        {isFile && workspacePath && (
          <MenuItem
            label="Open in Split"
            onClick={() => run(() => openFileInSplit(workspacePath, path))}
          />
        )}
        {isFile && (
          <MenuItem
            label="Reveal in Finder"
            onClick={() => run(() => api.revealInFinder(path))}
          />
        )}
        {(isDir || isWorkspace) && (
          <MenuItem
            label="Reveal in Finder"
            onClick={() => run(() => api.revealInFinder(path))}
          />
        )}
        {(isFile || isDir || isWorkspace) && (
          <>
            <Divider />
            <MenuItem
              label="Copy Path"
              onClick={() => run(() => api.clipboardWrite(path))}
            />
            {!isWorkspace && (
              <MenuItem
                label="Copy Relative Path"
                onClick={() => run(() => api.clipboardWrite(relativePath))}
              />
            )}
          </>
        )}
        {canRevert && (
          <>
            <Divider />
            <MenuItem
              label="Revert Changes"
              destructive
              onClick={() => run(() => onRevertRequest(node, vcsType!))}
            />
          </>
        )}
      </div>
    </OverlayWrapper>
  );
}

function MenuItem({
  label,
  onClick,
  destructive,
}: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--ctp-surface1)]"
      style={{ color: destructive ? "var(--ctp-red)" : "var(--ctp-text)" }}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-[var(--ctp-surface1)] mx-2 my-1" />;
}
