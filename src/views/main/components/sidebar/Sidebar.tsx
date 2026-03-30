import { useEffect, useState, useRef, useCallback } from "react";
import type { SourceRepo, TempestWorkspace } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { allPanes } from "../../models/pane-node";
import { RepoSection } from "./RepoSection";
import { SidebarToolbar } from "./SidebarToolbar";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { RepoSettingsDialog } from "./RepoSettingsDialog";

export function Sidebar() {
  const repos = useStore((s) => s.repos);
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);
  const sidebarInfo = useStore((s) => s.sidebarInfo);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const setRepos = useStore((s) => s.setRepos);
  const setWorkspaces = useStore((s) => s.setWorkspaces);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);

  const setSidebarInfo = useStore((s) => s.setSidebarInfo);
  const newWorkspaceRepoId = useStore((s) => s.newWorkspaceRepoId);
  const requestNewWorkspace = useStore((s) => s.requestNewWorkspace);

  const [addingRepo, setAddingRepo] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const addRepoInputRef = useRef<HTMLInputElement>(null);
  const [newWorkspaceRepo, setNewWorkspaceRepo] = useState<SourceRepo | null>(null);
  const [settingsRepo, setSettingsRepo] = useState<SourceRepo | null>(null);

  // Load repos and their workspaces on mount
  useEffect(() => {
    (async () => {
      const loadedRepos = await api.getRepos();
      setRepos(loadedRepos);
      for (const repo of loadedRepos) {
        const ws = await api.getWorkspaces(repo.id);
        setWorkspaces(repo.id, ws);
      }
    })();
  }, [setRepos, setWorkspaces]);

  // Handle menu-driven new workspace requests
  useEffect(() => {
    if (!newWorkspaceRepoId) return;
    const repo = repos.find((r) => r.id === newWorkspaceRepoId);
    if (repo) {
      setNewWorkspaceRepo(repo);
      requestNewWorkspace(null);
    }
    // Don't clear if repo not found yet — wait for repos to load
  }, [newWorkspaceRepoId, repos, requestNewWorkspace]);

  // Auto-fetch sidebar info when workspace selection changes
  useEffect(() => {
    if (!selectedWorkspacePath) return;
    api.getSidebarInfo(selectedWorkspacePath).then((info: any) => {
      if (info) setSidebarInfo(selectedWorkspacePath, info);
    });
  }, [selectedWorkspacePath, setSidebarInfo]);

  const handleAddRepo = () => {
    setAddingRepo(true);
    setRepoPath("");
    setAddRepoError(null);
    setTimeout(() => addRepoInputRef.current?.focus(), 0);
  };

  const handleAddRepoSubmit = async () => {
    const trimmed = repoPath.trim();
    if (!trimmed) return;
    setAddRepoError(null);
    const result = await api.addRepo(trimmed);
    if (result.success) {
      setAddingRepo(false);
      setRepoPath("");
      // Refresh repos list
      const loadedRepos = await api.getRepos();
      setRepos(loadedRepos);
      for (const repo of loadedRepos) {
        const ws = await api.getWorkspaces(repo.id);
        setWorkspaces(repo.id, ws);
      }
    } else {
      setAddRepoError(result.error ?? "Failed to add repository");
    }
  };

  const handleAddRepoCancel = () => {
    setAddingRepo(false);
    setRepoPath("");
    setAddRepoError(null);
  };

  const handleArchiveWorkspace = useCallback(async (workspace: TempestWorkspace) => {
    const { paneTrees, selectedWorkspacePath, selectWorkspace: select } = useStore.getState();

    // Kill all terminals in this workspace's pane tree
    const tree = paneTrees[workspace.path];
    if (tree) {
      for (const pane of allPanes(tree)) {
        for (const tab of pane.tabs) {
          if (tab.terminalId) {
            api.killTerminal({ id: tab.terminalId });
          }
        }
      }
    }

    // Archive via backend (VCS-level operation)
    await api.archiveWorkspace(workspace.id);

    // If the archived workspace was selected, switch to another
    if (selectedWorkspacePath === workspace.path) {
      const allWorkspaces = Object.values(useStore.getState().workspacesByRepo).flat();
      const other = allWorkspaces.find((w) => w.path !== workspace.path);
      select(other?.path ?? null);
    }
  }, []);

  const handleToggleExpanded = (repoIndex: number) => {
    const updated = repos.map((r, i) =>
      i === repoIndex ? { ...r, isExpanded: !r.isExpanded } : r
    );
    setRepos(updated);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--ctp-mantle)]">
      {/* Titlebar drag region — room for traffic lights */}
      <div className="titlebar-drag h-8 flex-shrink-0" />

      {/* Scrollable repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {addingRepo && (
          <div className="px-3 py-2 border-b border-[var(--ctp-surface0)]">
            <label className="block text-[11px] text-[var(--ctp-overlay1)] mb-1">
              Repository path
            </label>
            <input
              ref={addRepoInputRef}
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddRepoSubmit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleAddRepoCancel();
                }
              }}
              placeholder="/path/to/repository"
              className="w-full px-2 py-1 text-[12px] rounded bg-[var(--ctp-surface0)] text-[var(--ctp-text)] placeholder:text-[var(--ctp-overlay0)] border border-[var(--ctp-surface1)] outline-none focus:border-[var(--ctp-blue)]"
            />
            {addRepoError && (
              <p className="mt-1 text-[11px] text-[var(--ctp-red)]">{addRepoError}</p>
            )}
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={handleAddRepoSubmit}
                className="px-2 py-0.5 text-[11px] rounded bg-[var(--ctp-blue)] text-[var(--ctp-base)] hover:opacity-90 transition-opacity"
              >
                Add
              </button>
              <button
                onClick={handleAddRepoCancel}
                className="px-2 py-0.5 text-[11px] rounded text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {repos.length === 0 && !addingRepo ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--ctp-overlay0)]">
            No repositories added
          </div>
        ) : (
          repos.map((repo, index) => (
            <RepoSection
              key={repo.id}
              repo={repo}
              workspaces={workspacesByRepo[repo.id] ?? []}
              sidebarInfo={sidebarInfo}
              selectedWorkspacePath={selectedWorkspacePath}
              showDivider={index > 0}
              onSelectWorkspace={selectWorkspace}
              onArchiveWorkspace={handleArchiveWorkspace}
              onToggleExpanded={() => handleToggleExpanded(index)}
              onNewWorkspace={() => setNewWorkspaceRepo(repo)}
              onRefreshWorkspaces={() => {
                api.getWorkspaces(repo.id).then((ws: TempestWorkspace[]) => setWorkspaces(repo.id, ws));
              }}
              onRemoveRepo={() => {
                api.removeRepo(repo.id);
              }}
              onOpenSettings={() => setSettingsRepo(repo)}
              onRefreshSidebarInfo={(workspacePath) => {
                api.getSidebarInfo(workspacePath).then((info: any) => {
                  if (info) setSidebarInfo(workspacePath, info);
                });
              }}
            />
          ))
        )}
      </div>

      <SidebarToolbar onAddRepo={handleAddRepo} onOpenSettings={toggleCommandPalette} />

      {newWorkspaceRepo && (
        <NewWorkspaceDialog
          repo={newWorkspaceRepo}
          existingWorkspaces={workspacesByRepo[newWorkspaceRepo.id] ?? []}
          onCreated={(workspace) => {
            setNewWorkspaceRepo(null);
            selectWorkspace(workspace.path);
          }}
          onDismiss={() => setNewWorkspaceRepo(null)}
        />
      )}

      {settingsRepo && (
        <RepoSettingsDialog
          repo={settingsRepo}
          onDismiss={() => setSettingsRepo(null)}
        />
      )}
    </div>
  );
}
