import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AppConfig,
  SourceRepo,
  TempestWorkspace,
  VCSType,
  WorkspaceSidebarInfo,
} from "../shared/ipc-types";
import { WorkspaceStatus } from "../shared/ipc-types";
import {
  loadConfig,
  saveConfig as saveConfigFile,
  loadRepoPaths,
  saveRepoPaths,
  defaultConfig,
} from "./config/app-config";
import { detectVCS, detectVCSType } from "./vcs/detector";
import type { VCSProvider } from "./vcs/types";

export class WorkspaceManager {
  private repos: SourceRepo[] = [];
  private workspacesByRepo = new Map<string, TempestWorkspace[]>();
  private providers = new Map<string, VCSProvider>();
  private sidebarInfoCache = new Map<string, WorkspaceSidebarInfo>();
  private sidebarRefreshTimer?: ReturnType<typeof setInterval>;
  private config: AppConfig = defaultConfig();

  // Push-notification callbacks (set by index.ts after RPC is created)
  onWorkspacesChanged?: (
    repoId: string,
    workspaces: TempestWorkspace[],
  ) => void;
  onSidebarInfoUpdated?: (
    workspacePath: string,
    info: WorkspaceSidebarInfo,
  ) => void;
  onConfigChanged?: (config: AppConfig) => void;

  // --- Initialization ---

  async initialize(): Promise<void> {
    this.config = await loadConfig();
    const paths = await loadRepoPaths();
    for (const p of paths) {
      if (existsSync(p)) {
        try {
          await this.addRepoInternal(p);
        } catch {
          // Skip repos that can't be loaded
        }
      }
    }
    this.startSidebarRefresh();
  }

  // --- Config ---

  getConfig(): AppConfig {
    return this.config;
  }

  async saveConfig(config: AppConfig): Promise<void> {
    this.config = config;
    await saveConfigFile(config);
    this.onConfigChanged?.(config);
  }

  // --- Repos ---

  getRepos(): SourceRepo[] {
    return this.repos;
  }

  async addRepo(path: string): Promise<{ success: boolean; error?: string }> {
    const normalized = path.replace(/\/+$/, "");
    if (this.repos.some((r) => r.path === normalized)) {
      return { success: true }; // Already added
    }
    try {
      await this.addRepoInternal(normalized);
      await this.persistRepoList();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  }

  private async addRepoInternal(repoPath: string): Promise<void> {
    const provider = detectVCS(repoPath, this.config);
    const name = repoPath.split("/").pop() ?? repoPath;
    const repo: SourceRepo = {
      id: stableId(repoPath),
      path: repoPath,
      name,
      isExpanded: true,
      vcsType: provider.vcsType,
    };
    this.repos.push(repo);
    this.providers.set(repo.id, provider);
    await this.refreshWorkspacesInternal(repo);
  }

  removeRepo(repoId: string): void {
    this.repos = this.repos.filter((r) => r.id !== repoId);
    this.workspacesByRepo.delete(repoId);
    this.providers.delete(repoId);
    this.persistRepoList();
  }

  private async persistRepoList(): Promise<void> {
    const paths = this.repos.map((r) => r.path);
    await saveRepoPaths(paths);
  }

  // --- Workspaces ---

  getWorkspaces(repoId: string): TempestWorkspace[] {
    return this.workspacesByRepo.get(repoId) ?? [];
  }

  getAllWorkspaces(): TempestWorkspace[] {
    const all: TempestWorkspace[] = [];
    for (const ws of this.workspacesByRepo.values()) {
      all.push(...ws);
    }
    return all;
  }

  async createWorkspace(
    repoId: string,
    name: string,
    branch?: string,
    useExistingBranch?: boolean,
  ): Promise<{
    success: boolean;
    error?: string;
    workspace?: TempestWorkspace;
  }> {
    const repo = this.repos.find((r) => r.id === repoId);
    const provider = this.providers.get(repoId);
    if (!repo || !provider) {
      return { success: false, error: "Repository not found" };
    }

    try {
      const wsRoot = join(
        this.config.workspaceRoot,
        repoSlug(repo.path),
        name,
      );
      const parentDir = join(wsRoot, "..");
      mkdirSync(parentDir, { recursive: true });

      const workspace = await provider.createWorkspace(
        name,
        wsRoot,
        branch,
        useExistingBranch,
      );
      workspace.repoPath = repo.path;

      const existing = this.workspacesByRepo.get(repoId) ?? [];
      existing.push(workspace);
      this.workspacesByRepo.set(repoId, existing);

      this.onWorkspacesChanged?.(repoId, existing);
      return { success: true, workspace };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  }

  async archiveWorkspace(
    workspaceId: string,
  ): Promise<{ success: boolean; error?: string }> {
    for (const [repoId, workspaces] of this.workspacesByRepo) {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) continue;

      const provider = this.providers.get(repoId);
      if (!provider) return { success: false, error: "Provider not found" };

      try {
        await provider.archiveWorkspace(workspace);
        const updated = workspaces.filter((w) => w.id !== workspaceId);
        this.workspacesByRepo.set(repoId, updated);
        this.onWorkspacesChanged?.(repoId, updated);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? String(err) };
      }
    }
    return { success: false, error: "Workspace not found" };
  }

  async refreshWorkspaces(repoId: string): Promise<TempestWorkspace[]> {
    const repo = this.repos.find((r) => r.id === repoId);
    if (!repo) return [];
    await this.refreshWorkspacesInternal(repo);
    const workspaces = this.workspacesByRepo.get(repoId) ?? [];
    this.onWorkspacesChanged?.(repoId, workspaces);
    return workspaces;
  }

  private async refreshWorkspacesInternal(repo: SourceRepo): Promise<void> {
    const provider = this.providers.get(repo.id);
    if (!provider) return;

    const wsNames = await provider.listWorkspaceNames();
    const wsRoot = join(this.config.workspaceRoot, repoSlug(repo.path));
    const workspaces: TempestWorkspace[] = [];

    for (const name of wsNames) {
      if (name === "default") {
        workspaces.push({
          id: stableId(repo.path),
          name,
          path: repo.path,
          repoPath: repo.path,
          status: WorkspaceStatus.Idle,
        });
        continue;
      }

      const expectedPath = join(wsRoot, name);
      if (existsSync(expectedPath)) {
        workspaces.push({
          id: stableId(expectedPath),
          name,
          path: expectedPath,
          repoPath: repo.path,
          status: WorkspaceStatus.Idle,
        });
      }
    }

    this.workspacesByRepo.set(repo.id, workspaces);
  }

  // --- Sidebar Info ---

  async getSidebarInfo(workspacePath: string): Promise<WorkspaceSidebarInfo> {
    const cached = this.sidebarInfoCache.get(workspacePath);
    if (cached) return cached;

    // Trigger an async refresh and return empty for now
    this.refreshSidebarInfo(workspacePath);
    return {};
  }

  private async refreshSidebarInfo(workspacePath: string): Promise<void> {
    const workspace = this.findWorkspaceByPath(workspacePath);
    if (!workspace) return;

    const repo = this.repos.find((r) => r.path === workspace.repoPath);
    if (!repo) return;

    const provider = this.providers.get(repo.id);
    if (!provider) return;

    try {
      const [bookmarkName, diffStats] = await Promise.all([
        provider.bookmarkName(workspace),
        provider.diffStats(workspace),
      ]);
      const info: WorkspaceSidebarInfo = { bookmarkName, diffStats };
      this.sidebarInfoCache.set(workspacePath, info);
      this.onSidebarInfoUpdated?.(workspacePath, info);
    } catch {
      // Keep existing cache on error
    }
  }

  private startSidebarRefresh(): void {
    this.stopSidebarRefresh();

    // Initial refresh for all workspaces
    for (const ws of this.getAllWorkspaces()) {
      this.refreshSidebarInfo(ws.path);
    }

    // Periodic refresh every 15 seconds
    this.sidebarRefreshTimer = setInterval(() => {
      for (const ws of this.getAllWorkspaces()) {
        this.refreshSidebarInfo(ws.path);
      }
    }, 15_000);
  }

  stopSidebarRefresh(): void {
    if (this.sidebarRefreshTimer) {
      clearInterval(this.sidebarRefreshTimer);
      this.sidebarRefreshTimer = undefined;
    }
  }

  // --- VCS Type ---

  getVCSType(repoPath: string): VCSType {
    return detectVCSType(repoPath);
  }

  // --- Helpers ---

  private findWorkspaceByPath(path: string): TempestWorkspace | undefined {
    for (const workspaces of this.workspacesByRepo.values()) {
      const ws = workspaces.find((w) => w.path === path);
      if (ws) return ws;
    }
    return undefined;
  }
}

/**
 * Derive a stable ID from a path using SHA-256.
 * Same path always produces the same ID, so refreshes don't break client-side tracking.
 */
function stableId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

/**
 * Derive a slug from repo path for workspace directory namespacing.
 * e.g., /Users/me/code/app -> "code-app"
 */
function repoSlug(repoPath: string): string {
  const components = repoPath.split("/").filter((c) => c !== "");
  return components.slice(-2).join("-");
}
