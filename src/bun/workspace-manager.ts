import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  AppConfig,
  RepoSettings,
  SourceRepo,
  TempestWorkspace,
  WorkspaceSidebarInfo,
} from "../shared/ipc-types";
import { VCSType, WorkspaceStatus } from "../shared/ipc-types";
import {
  loadConfig,
  saveConfig as saveConfigFile,
  loadRepoPaths,
  saveRepoPaths,
  defaultConfig,
} from "./config/app-config";
import {
  loadAllRepoSettings,
  saveAllRepoSettings,
} from "./config/repo-settings";
import { detectVCS, detectVCSType } from "./vcs/detector";
import type { VCSProvider } from "./vcs/types";
import { PathResolver } from "./config/path-resolver";
import { WEBPAGE_PREVIEWS_DIR } from "./config/paths";

export class WorkspaceManager {
  private repos: SourceRepo[] = [];
  private workspacesByRepo = new Map<string, TempestWorkspace[]>();
  private providers = new Map<string, VCSProvider>();
  private sidebarInfoCache = new Map<string, WorkspaceSidebarInfo>();
  private remoteReposCache = new Map<string, string[]>();
  private repoSettings: Record<string, RepoSettings> = {};
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
    this.repoSettings = await loadAllRepoSettings();
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

  async cloneRepo(params: {
    vcsType: VCSType;
    url: string;
    localPath: string;
    colocate?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const { vcsType, url, localPath, colocate } = params;
    const expandedPath = localPath.replace(/^~(?=\/|$)/, homedir());

    if (existsSync(expandedPath)) {
      return { success: false, error: `Path already exists: ${expandedPath}` };
    }

    const parentDir = join(expandedPath, "..");
    mkdirSync(parentDir, { recursive: true });

    try {
      const resolver = new PathResolver();
      let command: string[];
      if (vcsType === VCSType.JJ) {
        const jjPath = resolver.resolve("jj", this.config.jjPath);
        command = [jjPath, "git", "clone", colocate ? "--colocate" : "--no-colocate", url, expandedPath];
      } else {
        const gitPath = resolver.resolve("git", this.config.gitPath);
        command = [gitPath, "clone", url, expandedPath];
      }

      const proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        try { await rm(expandedPath, { recursive: true, force: true }); } catch {}
        return {
          success: false,
          error: `Clone failed (exit ${exitCode}):\n${(stderr || stdout).trim()}`,
        };
      }

      return await this.addRepo(expandedPath);
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
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

  async getBranches(repoId: string): Promise<string[]> {
    const provider = this.providers.get(repoId);
    if (!provider) return [];
    try {
      return await provider.listBranches();
    } catch {
      return [];
    }
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

      // Run prepare script if configured
      const settings = this.repoSettings[repo.path];
      if (settings?.prepareScript?.trim()) {
        const result = await this.runPrepareScript(settings.prepareScript, wsRoot);
        if (result.exitCode !== 0) {
          console.warn(
            `[workspace] Prepare script failed (exit ${result.exitCode}):`,
            result.output,
          );
          return {
            success: true,
            workspace,
            error: `Prepare script failed (exit ${result.exitCode}):\n${result.output}`,
          };
        }
      }

      return { success: true, workspace };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  }

  async renameWorkspace(
    workspaceId: string,
    newName: string,
  ): Promise<{
    success: boolean;
    error?: string;
    workspace?: TempestWorkspace;
    oldPath?: string;
    newPath?: string;
    repoId?: string;
  }> {
    const invalidChars = /[/\\:*?"<>|. ]/;
    if (invalidChars.test(newName)) {
      return { success: false, error: "Name contains invalid characters" };
    }

    for (const [repoId, workspaces] of this.workspacesByRepo) {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) continue;

      if (workspace.name === "default") {
        return { success: false, error: "Cannot rename the default workspace" };
      }

      if (workspace.name === newName) {
        return { success: false, error: "New name is the same as the current name" };
      }

      if (workspaces.some((w) => w.name === newName && w.id !== workspaceId)) {
        return { success: false, error: "A workspace with that name already exists" };
      }

      const provider = this.providers.get(repoId);
      if (!provider) return { success: false, error: "Provider not found" };

      const repo = this.repos.find((r) => r.id === repoId);
      if (!repo) return { success: false, error: "Repository not found" };

      const newPath = join(
        this.config.workspaceRoot,
        repoSlug(repo.path),
        newName,
      );
      const oldPath = workspace.path;

      if (existsSync(newPath)) {
        return { success: false, error: "A directory with that name already exists" };
      }

      try {
        await provider.renameWorkspace(workspace, newName, newPath);

        // Migrate sidebarInfoCache
        const cachedInfo = this.sidebarInfoCache.get(oldPath);
        if (cachedInfo) {
          this.sidebarInfoCache.delete(oldPath);
          this.sidebarInfoCache.set(newPath, cachedInfo);
        }

        // Move webpage previews directory
        const oldPreviewDir = join(WEBPAGE_PREVIEWS_DIR, workspace.name);
        const newPreviewDir = join(WEBPAGE_PREVIEWS_DIR, newName);
        if (existsSync(oldPreviewDir)) {
          const { rename } = await import("node:fs/promises");
          await rename(oldPreviewDir, newPreviewDir).catch(() => {});
        }

        // Update in-memory workspace list
        const updated = workspaces.map((w) =>
          w.id === workspaceId
            ? {
                ...w,
                id: stableId(newPath),
                name: newName,
                path: newPath,
              }
            : w,
        );
        this.workspacesByRepo.set(repoId, updated);
        const renamedWorkspace = updated.find((w) => w.path === newPath)!;

        this.onWorkspacesChanged?.(repoId, updated);

        return {
          success: true,
          workspace: renamedWorkspace,
          oldPath,
          newPath,
          repoId,
        };
      } catch (err: any) {
        return { success: false, error: err.message ?? String(err) };
      }
    }
    return { success: false, error: "Workspace not found" };
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
        // Run archive script if configured
        const settings = this.repoSettings[workspace.repoPath];
        if (settings?.archiveScript?.trim()) {
          const result = await this.runPrepareScript(settings.archiveScript, workspace.path);
          if (result.exitCode !== 0) {
            console.warn(
              `[workspace] Archive script failed (exit ${result.exitCode}):`,
              result.output,
            );
            return {
              success: false,
              error: `Archive script failed (exit ${result.exitCode}):\n${result.output}`,
            };
          }
        }

        await provider.archiveWorkspace(workspace);

        // Clean up webpage preview files for this workspace
        const wsName = workspace.name || workspace.path.split("/").pop() || "";
        if (wsName) {
          const previewDir = join(WEBPAGE_PREVIEWS_DIR, wsName);
          await rm(previewDir, { recursive: true, force: true }).catch(() => {});
        }

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

    const wsRoot = join(this.config.workspaceRoot, repoSlug(repo.path));
    const entries = await provider.listWorkspaces(wsRoot);
    const workspaces: TempestWorkspace[] = [];

    for (const entry of entries) {
      if (existsSync(entry.path)) {
        workspaces.push({
          id: stableId(entry.path),
          name: entry.name,
          path: entry.path,
          repoPath: repo.path,
          status: WorkspaceStatus.Idle,
        });
      }
    }

    this.workspacesByRepo.set(repo.id, workspaces);
  }

  // --- Repo Settings ---

  getRepoSettings(repoPath: string): RepoSettings {
    return this.repoSettings[repoPath] ?? { prepareScript: "", archiveScript: "" };
  }

  async saveRepoSettings(repoPath: string, settings: RepoSettings): Promise<void> {
    this.repoSettings[repoPath] = settings;
    await saveAllRepoSettings(this.repoSettings);
  }

  async runPrepareScript(
    script: string,
    cwd: string,
  ): Promise<{ exitCode: number; output: string }> {
    try {
      const proc = Bun.spawn(["/bin/zsh", "-l", "-c", script], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      const output = (stdout + stderr).trim();
      return { exitCode, output };
    } catch (err: any) {
      return { exitCode: 1, output: err.message ?? String(err) };
    }
  }

  // --- Remote Repos (cached) ---

  async getRemoteRepos(repoPath: string): Promise<string[]> {
    const cached = this.remoteReposCache.get(repoPath);
    if (cached) return cached;

    try {
      const gitPath = this.config.gitPath ?? "git";
      const proc = Bun.spawn([gitPath, "remote", "-v"], {
        cwd: repoPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Parse "origin\tgit@github.com:Owner/Repo.git (fetch)" lines
      // Extract unique owner/repo slugs
      const slugs = new Set<string>();
      for (const line of stdout.split("\n")) {
        const url = line.split(/\s+/)[1];
        if (!url) continue;
        // SSH: git@github.com:Owner/Repo.git
        const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
        if (sshMatch?.[1]) { slugs.add(sshMatch[1]); continue; }
        // HTTPS: https://github.com/Owner/Repo.git
        const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
        if (httpsMatch?.[1]) { slugs.add(httpsMatch[1]); }
      }

      const result = Array.from(slugs);
      this.remoteReposCache.set(repoPath, result);
      return result;
    } catch {
      return [];
    }
  }

  // --- Custom Script Execution ---

  // Push-notification callback for script output streaming (set by index.ts)
  onScriptOutput?: (runId: string, data: string) => void;
  onScriptExit?: (runId: string, exitCode: number) => void;

  async runCustomScript(params: {
    repoPath: string;
    workspacePath: string;
    workspaceName: string;
    script?: string;
    scriptPath?: string;
    paramValues?: Record<string, string>;
  }): Promise<{ runId: string }> {
    const { repoPath, workspacePath, workspaceName, script, scriptPath, paramValues } = params;
    const runId = crypto.randomUUID();

    // Build env vars
    const remoteRepos = await this.getRemoteRepos(repoPath);
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      REMOTE_REPOS: remoteRepos.join(" "),
      WORKSPACE_NAME: workspaceName,
    };

    // Add user-defined parameter values as env vars
    if (paramValues) {
      for (const [key, value] of Object.entries(paramValues)) {
        env[key] = value;
      }
    }

    // Determine what to execute
    let command: string[];
    if (scriptPath) {
      command = ["/bin/zsh", "-l", "-c", scriptPath];
    } else if (script) {
      command = ["/bin/zsh", "-l", "-c", script];
    } else {
      // Fire error immediately and return
      setTimeout(() => {
        this.onScriptOutput?.(runId, "No script or scriptPath provided\n");
        this.onScriptExit?.(runId, 1);
      }, 0);
      return { runId };
    }

    // Spawn async — stream output, don't block the RPC response
    const self = this;
    (async () => {
      try {
        const proc = Bun.spawn(command, {
          cwd: workspacePath,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });

        // Stream stdout and stderr concurrently
        const streamReader = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            self.onScriptOutput?.(runId, decoder.decode(value, { stream: true }));
          }
        };

        await Promise.all([
          streamReader(proc.stdout as ReadableStream<Uint8Array>),
          streamReader(proc.stderr as ReadableStream<Uint8Array>),
        ]);

        const exitCode = await proc.exited;
        self.onScriptExit?.(runId, exitCode);
      } catch (err: any) {
        self.onScriptOutput?.(runId, err.message ?? String(err));
        self.onScriptExit?.(runId, 1);
      }
    })();

    return { runId };
  }

  async getPackageScripts(workspacePath: string): Promise<{ scripts: Array<{ name: string; command: string }> }> {
    try {
      const pkgPath = join(workspacePath, "package.json");
      if (!existsSync(pkgPath)) return { scripts: [] };

      const raw = await Bun.file(pkgPath).text();
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts;
      if (!scripts || typeof scripts !== "object") return { scripts: [] };

      // Detect runner from lock files
      let runner = "npm";
      if (existsSync(join(workspacePath, "bun.lock")) || existsSync(join(workspacePath, "bun.lockb"))) {
        runner = "bun";
      } else if (existsSync(join(workspacePath, "yarn.lock"))) {
        runner = "yarn";
      } else if (existsSync(join(workspacePath, "pnpm-lock.yaml"))) {
        runner = "pnpm";
      }

      return {
        scripts: Object.keys(scripts).map((name) => ({
          name,
          command: `${runner} run ${name}`,
        })),
      };
    } catch {
      return { scripts: [] };
    }
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
      const [bookmarkName, diffStats, branchHealth] = await Promise.all([
        provider.bookmarkName(workspace),
        provider.diffStats(workspace),
        provider.branchHealth(workspace).catch(() => undefined),
      ]);
      const info: WorkspaceSidebarInfo = { bookmarkName, diffStats, branchHealth };
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
    this.sidebarRefreshTimer = setInterval(async () => {
      // Re-enumerate workspaces to discover external additions/removals
      try {
        await this.checkForWorkspaceChanges();
      } catch (err) {
        console.error("[workspace] workspace check failed:", err);
      }

      // Refresh sidebar info (includes any newly discovered workspaces)
      for (const ws of this.getAllWorkspaces()) {
        this.refreshSidebarInfo(ws.path);
      }
    }, 15_000);
  }

  private async checkForWorkspaceChanges(): Promise<void> {
    for (const repo of this.repos) {
      const oldKey = this.workspaceListKey(
        this.workspacesByRepo.get(repo.id) ?? [],
      );
      await this.refreshWorkspacesInternal(repo);
      const newWorkspaces = this.workspacesByRepo.get(repo.id) ?? [];
      const newKey = this.workspaceListKey(newWorkspaces);
      if (oldKey !== newKey) {
        this.onWorkspacesChanged?.(repo.id, newWorkspaces);
      }
    }
  }

  private workspaceListKey(workspaces: TempestWorkspace[]): string {
    return workspaces
      .map((w) => w.id)
      .sort()
      .join("|");
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

  /**
   * Resolve the VCS bookmark/branch name and repo path for a workspace.
   * Uses the VCS provider (jj or git) so jj bookmarks are handled correctly.
   */
  async getWorkspaceVCSInfo(
    workspacePath: string,
  ): Promise<{ repoPath: string; branch: string } | null> {
    const ws = this.findWorkspaceByPath(workspacePath);
    if (!ws) return null;
    const repo = this.repos.find((r) => r.path === ws.repoPath);
    if (!repo) return null;
    const provider = this.providers.get(repo.id);
    if (!provider) return null;
    const branch = await provider.bookmarkName(ws);
    if (!branch) return null;
    return { repoPath: repo.path, branch };
  }

  /**
   * Build the GitHub URL for a workspace. If the current branch/bookmark has
   * been pushed, the URL includes /tree/<branch>. Otherwise just the repo root.
   */
  async getRepoGitHubUrl(
    workspacePath: string,
  ): Promise<{ url: string } | { error: string }> {
    const ws = this.findWorkspaceByPath(workspacePath);
    if (!ws) return { error: "Workspace not found." };

    const repo = this.repos.find((r) => r.path === ws.repoPath);
    if (!repo) return { error: "Repository not found." };

    const slugs = await this.getRemoteRepos(ws.repoPath);
    if (slugs.length === 0) return { error: "No remote repository configured." };

    const baseUrl = `https://github.com/${slugs[0]}`;

    const provider = this.providers.get(repo.id);
    if (!provider) return { url: baseUrl };

    const branch = await provider.bookmarkName(ws);
    if (!branch) return { url: baseUrl };

    // Check if the branch has been pushed to origin
    const pushed = await this.isBranchPushed(ws.repoPath, branch, provider.vcsType);
    if (pushed) {
      return { url: `${baseUrl}/tree/${encodeURIComponent(branch)}` };
    }
    return { url: baseUrl };
  }

  private async isBranchPushed(
    repoPath: string,
    branch: string,
    vcsType: VCSType,
  ): Promise<boolean> {
    try {
      if (vcsType === VCSType.JJ) {
        const jjPath = new (await import("./config/path-resolver")).PathResolver().resolve(
          "jj",
          this.config.jjPath,
        );
        const proc = Bun.spawn(
          [jjPath, "bookmark", "list", "--tracked", "-T", 'name ++ "\\n"'],
          { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        return stdout.split("\n").some((l) => l.trim() === branch);
      } else {
        const gitPath = new (await import("./config/path-resolver")).PathResolver().resolve(
          "git",
          this.config.gitPath,
        );
        const proc = Bun.spawn(
          [gitPath, "rev-parse", "--verify", `refs/remotes/origin/${branch}`],
          { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
        );
        await proc.exited;
        return proc.exitCode === 0;
      }
    } catch {
      return false;
    }
  }

  // --- Helpers ---

  findWorkspaceByPath(path: string): TempestWorkspace | undefined {
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
