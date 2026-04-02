import { useEffect, useState, useCallback } from "react";
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

  const [addRepoError, setAddRepoError] = useState<string | null>(null);
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

  const handleAddRepo = async () => {
    setAddRepoError(null);
    const result = await api.browseDirectory("~/");
    if (!result.path) return; // user cancelled the dialog
    const addResult = await api.addRepo(result.path);
    if (addResult.success) {
      const loadedRepos = await api.getRepos();
      setRepos(loadedRepos);
      for (const repo of loadedRepos) {
        const ws = await api.getWorkspaces(repo.id);
        setWorkspaces(repo.id, ws);
      }
    } else {
      setAddRepoError(addResult.error ?? "Failed to add repository");
    }
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

    // If the archived workspace was focused, switch to the default workspace
    if (selectedWorkspacePath === workspace.path) {
      const { workspacesByRepo } = useStore.getState();
      const repoId = Object.keys(workspacesByRepo).find((id) =>
        workspacesByRepo[id].some((w) => w.path === workspace.path)
      );
      const defaultWs = repoId
        ? workspacesByRepo[repoId].find((w) => w.name === "default")
        : undefined;
      select(defaultWs?.path ?? null);
    }
  }, []);

  const handleToggleExpanded = (repoIndex: number) => {
    const updated = repos.map((r, i) =>
      i === repoIndex ? { ...r, isExpanded: !r.isExpanded } : r
    );
    setRepos(updated);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--ctp-mantle)] select-none">
      {/* Titlebar drag region — room for traffic lights */}
      <div className="electrobun-webkit-app-region-drag h-8 flex-shrink-0" />

      {/* Scrollable repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {addRepoError && (
          <div className="px-3 py-2 border-b border-[var(--ctp-surface0)]">
            <p className="text-[11px] text-[var(--ctp-red)]">{addRepoError}</p>
          </div>
        )}
        {repos.length === 0 ? (
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
              onRemoveRepo={async () => {
                await api.removeRepo(repo.id);
                const loadedRepos = await api.getRepos();
                setRepos(loadedRepos);
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
