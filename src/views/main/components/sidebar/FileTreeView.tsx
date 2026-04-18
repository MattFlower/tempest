// File tree view — unified 3-level tree: repo → workspace → files.
// Phase 1. Top levels (repo, workspace) render synchronously from existing
// store data. File/folder levels are lazy-loaded via api.listDir (see
// useExpandEffects) and pushed into fileTreeEntries.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { openFileInWorkspace } from "../../state/actions";
import { allPanes, findPane } from "../../models/pane-node";
import { FileTreeNode, type TreeNode } from "./FileTreeNode";

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
      api.watchDirectoryTree(wsPath).catch(() => {});
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
      api.watchDirectoryTree(wsPath).catch(() => {});
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
      api.listDir(path).then(
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
  ]);

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
    if (visibleNodes.length === 0) return;
    const cursorIdx = cursor ? visibleNodes.findIndex((n) => n.id === cursor) : -1;

    // If cursor is lost (no id set, or its node is no longer visible), any
    // arrow key parks it on the first visible row. This is friendly — user
    // doesn't have to click first.
    if (cursorIdx < 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setCursor(visibleNodes[0]!.id);
      return;
    }

    const current = cursorIdx >= 0 ? visibleNodes[cursorIdx]! : null;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (cursorIdx < visibleNodes.length - 1) {
          setCursor(visibleNodes[cursorIdx + 1]!.id);
        }
        return;
      case "ArrowUp":
        e.preventDefault();
        if (cursorIdx > 0) {
          setCursor(visibleNodes[cursorIdx - 1]!.id);
        }
        return;
      case "ArrowRight":
        e.preventDefault();
        if (!current) return;
        if (current.expandable && !current.isExpanded) {
          toggleExpanded(current, true);
        } else if (current.expandable && current.isExpanded) {
          // Move cursor to first child (next row is always a child when expanded).
          if (cursorIdx + 1 < visibleNodes.length) {
            setCursor(visibleNodes[cursorIdx + 1]!.id);
          }
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (!current) return;
        if (current.expandable && current.isExpanded) {
          toggleExpanded(current, false);
        } else {
          const parentIdx = findParentIdx(cursorIdx);
          if (parentIdx >= 0) setCursor(visibleNodes[parentIdx]!.id);
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
        setCursor(visibleNodes[0]!.id);
        return;
      case "End":
        e.preventDefault();
        setCursor(visibleNodes[visibleNodes.length - 1]!.id);
        return;
    }
  }, [cursor, visibleNodes, setCursor, toggleExpanded, openFileNode]);

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
        className="px-3 py-2 text-[10px] uppercase tracking-wider flex-shrink-0"
        style={{
          color: "var(--ctp-overlay1)",
          borderBottom: "1px solid var(--ctp-surface0)",
          letterSpacing: "0.08em",
        }}
      >
        Files
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
        ) : (
          visibleNodes.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              isCursor={node.id === cursor}
              onClick={handleClick}
              rowRef={node.id === cursor ? cursorRowRef : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
