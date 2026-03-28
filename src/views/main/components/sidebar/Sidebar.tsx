import { useEffect } from "react";
import type { TempestWorkspace } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { RepoSection } from "./RepoSection";
import { SidebarToolbar } from "./SidebarToolbar";

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

  // Auto-fetch sidebar info when workspace selection changes
  useEffect(() => {
    if (!selectedWorkspacePath) return;
    api.getSidebarInfo(selectedWorkspacePath).then((info: any) => {
      if (info) setSidebarInfo(selectedWorkspacePath, info);
    });
  }, [selectedWorkspacePath, setSidebarInfo]);

  const handleAddRepo = async () => {
    // TODO: open native file picker dialog via RPC when available
    // For now this is a stub — Stream D will provide the dialog
  };

  const handleToggleExpanded = (repoIndex: number) => {
    const updated = repos.map((r, i) =>
      i === repoIndex ? { ...r, isExpanded: !r.isExpanded } : r
    );
    setRepos(updated);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--ctp-mantle)]">
      {/* Scrollable repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
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
              onToggleExpanded={() => handleToggleExpanded(index)}
              onNewWorkspace={() => {
                api.createWorkspace({ repoId: repo.id, name: "" });
              }}
              onRefreshWorkspaces={() => {
                api.getWorkspaces(repo.id).then((ws: TempestWorkspace[]) => setWorkspaces(repo.id, ws));
              }}
              onRemoveRepo={() => {
                api.removeRepo(repo.id);
              }}
            />
          ))
        )}
      </div>

      <SidebarToolbar onAddRepo={handleAddRepo} onOpenSettings={toggleCommandPalette} />
    </div>
  );
}
