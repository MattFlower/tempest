import { randomBytes } from "node:crypto";
import type { WorkspaceManager } from "./workspace-manager";
import type { SessionActivityTracker } from "./hooks/session-activity-tracker";
import { ActivityState } from "../shared/ipc-types";
import type { HttpServerConfig, SourceRepo, TempestWorkspace } from "../shared/ipc-types";

export interface HttpServerDeps {
  workspaceManager: WorkspaceManager;
  activityTracker: SessionActivityTracker;
}

// Pending prompts queued by the HTTP server, consumed by TerminalPane when
// the workspace is first opened in the UI and a Claude terminal is created.
const pendingPrompts = new Map<string, string>();

export function queuePendingPrompt(workspacePath: string, prompt: string): void {
  pendingPrompts.set(workspacePath, prompt);
}

export function consumePendingPrompt(workspacePath: string): string | undefined {
  const prompt = pendingPrompts.get(workspacePath);
  if (prompt !== undefined) pendingPrompts.delete(workspacePath);
  return prompt;
}

export class TempestHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private deps: HttpServerDeps;
  private token: string = "";
  private port: number = 7778;
  private hostname: string = "127.0.0.1";
  private lastError: string | null = null;

  // Callback to push a "select workspace" message to the webview
  onSelectWorkspace?: (workspacePath: string) => void;

  constructor(deps: HttpServerDeps) {
    this.deps = deps;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }

  getHostname(): string {
    return this.hostname;
  }

  getToken(): string {
    return this.token;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  start(config: HttpServerConfig): { port: number; hostname: string; token: string; error?: string } {
    if (this.server) {
      this.server.stop(true);
    }

    this.port = config.port;
    this.hostname = config.hostname || "127.0.0.1";
    this.token = config.token || randomBytes(32).toString("hex");
    this.lastError = null;

    try {
      this.server = Bun.serve({
        port: this.port,
        hostname: this.hostname,
        fetch: (req) => this.handleRequest(req),
      });
    } catch (err: any) {
      this.server = null;
      const message = err?.code === "EADDRINUSE"
        ? `Port ${this.port} is already in use. Stop the other process or choose a different port.`
        : `Failed to start server: ${err?.message ?? String(err)}`;
      this.lastError = message;
      console.error(`[http-server] ${message}`);
      return { port: this.port, hostname: this.hostname, token: this.token, error: message };
    }

    console.log(`[http-server] Started on ${this.hostname}:${this.port}`);
    return { port: this.port, hostname: this.hostname, token: this.token };
  }

  stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
      console.log("[http-server] Stopped");
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Auth check for all routes
    if (!this.checkAuth(req)) {
      // For the HTML page, redirect to a login prompt
      if (path === "/" && req.method === "GET") {
        const provided = url.searchParams.get("token");
        if (!provided) {
          return new Response(LOGIN_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      // HTML dashboard
      if (path === "/" && req.method === "GET") {
        return new Response(this.renderDashboard(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // API: get full status
      if (path === "/api/status" && req.method === "GET") {
        return Response.json(this.getStatus());
      }

      // API: create workspace and launch Claude
      if (path === "/api/workspaces" && req.method === "POST") {
        const body = await req.json() as {
          repoId: string;
          name: string;
          prompt?: string;
          branch?: string;
        };
        return Response.json(await this.createWorkspaceAndPrompt(body));
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (err: any) {
      console.error("[http-server] Request error:", err);
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500 },
      );
    }
  }

  private checkAuth(req: Request): boolean {
    // Check Authorization header
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7) === this.token;
    }

    // Check query parameter (for browser access)
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token");
    if (tokenParam === this.token) {
      return true;
    }

    return false;
  }

  private getStatus(): {
    repos: Array<{
      repo: SourceRepo;
      workspaces: Array<{
        workspace: TempestWorkspace;
        activityState: string;
      }>;
    }>;
  } {
    const { workspaceManager, activityTracker } = this.deps;
    const repos = workspaceManager.getRepos();

    return {
      repos: repos.map((repo) => {
        const workspaces = workspaceManager.getWorkspaces(repo.id);
        return {
          repo,
          workspaces: workspaces.map((ws) => {
            const pids = activityTracker.pidsForCWD(ws.path);
            const state = activityTracker.aggregateState(pids);
            let activityLabel: string;
            if (state === ActivityState.Working) activityLabel = "working";
            else if (state === ActivityState.NeedsInput) activityLabel = "needsInput";
            else if (state === ActivityState.Idle) activityLabel = "idle";
            else activityLabel = ws.status;
            return { workspace: ws, activityState: activityLabel };
          }),
        };
      }),
    };
  }

  private async createWorkspaceAndPrompt(params: {
    repoId: string;
    name: string;
    prompt?: string;
    branch?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    workspaceId?: string;
    workspacePath?: string;
  }> {
    const { workspaceManager } = this.deps;

    // Create the workspace
    const result = await workspaceManager.createWorkspace(
      params.repoId,
      params.name,
      params.branch,
    );

    if (!result.success || !result.workspace) {
      return { success: false, error: result.error ?? "Failed to create workspace" };
    }

    const workspace = result.workspace;

    // Queue the prompt — it will be consumed when the workspace is opened
    // in the UI and the Claude terminal is lazily initialized.
    if (params.prompt?.trim()) {
      queuePendingPrompt(workspace.path, params.prompt.trim());
    }

    // Auto-select the workspace in the UI so the terminal initializes
    this.onSelectWorkspace?.(workspace.path);

    return {
      success: true,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
    };
  }

  private renderDashboard(): string {
    const status = this.getStatus();
    return dashboardHTML(status, this.token);
  }
}

// --- Styles ---

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1e1e2e;
    color: #cdd6f4;
    line-height: 1.5;
  }
  .login-container {
    max-width: 400px;
    margin: 120px auto;
    text-align: center;
  }
  .login-container h1 {
    font-size: 2rem;
    margin-bottom: 0.5rem;
    color: #89b4fa;
  }
  .login-container p {
    color: #a6adc8;
    margin-bottom: 1.5rem;
  }
  .login-container input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #45475a;
    border-radius: 8px;
    background: #313244;
    color: #cdd6f4;
    font-size: 1rem;
    margin-bottom: 1rem;
  }
  .login-container button {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 8px;
    background: #89b4fa;
    color: #1e1e2e;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .login-container button:hover { background: #74c7ec; }
`;

const DASHBOARD_STYLES = `
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid #313244;
  }
  header h1 {
    font-size: 1.4rem;
    color: #89b4fa;
  }
  .refresh-info {
    font-size: 0.8rem;
    color: #6c7086;
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }
  .repo-section {
    background: #181825;
    border: 1px solid #313244;
    border-radius: 12px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  .repo-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid #313244;
    background: #1e1e2e;
  }
  .repo-header h2 {
    font-size: 1.1rem;
    color: #cdd6f4;
  }
  .vcs-badge {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    background: #45475a;
    color: #a6adc8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-add {
    margin-left: auto;
    background: #313244;
    color: #89b4fa;
  }
  .btn-add:hover { background: #45475a; }
  .ws-table {
    width: 100%;
    border-collapse: collapse;
  }
  .ws-table th {
    text-align: left;
    padding: 8px 16px;
    font-size: 0.75rem;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #313244;
  }
  .ws-table td {
    padding: 10px 16px;
    border-bottom: 1px solid #313244;
    font-size: 0.9rem;
  }
  .ws-table tr:last-child td { border-bottom: none; }
  .status-cell { width: 24px; }
  .status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .ws-name { font-weight: 500; }
  .ws-status { color: #a6adc8; }
  .ws-path { color: #585b70; font-size: 0.8rem; font-family: monospace; }
  .empty-row { color: #585b70; text-align: center; font-style: italic; }
  .empty-state { text-align: center; color: #585b70; padding: 60px 20px; }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 12px;
    padding: 24px;
    width: 500px;
    max-width: 90vw;
  }
  .modal h3 {
    margin-bottom: 16px;
    color: #cdd6f4;
  }
  .modal label {
    display: block;
    font-size: 0.85rem;
    color: #a6adc8;
    margin-bottom: 4px;
    margin-top: 12px;
  }
  .optional { color: #585b70; }
  .modal input[type="text"], .modal textarea {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #45475a;
    border-radius: 6px;
    background: #313244;
    color: #cdd6f4;
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
  }
  .modal input:focus, .modal textarea:focus {
    outline: none;
    border-color: #89b4fa;
  }
  .modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
  .btn-cancel { background: #313244; color: #cdd6f4; }
  .btn-cancel:hover { background: #45475a; }
  .btn-submit { background: #89b4fa; color: #1e1e2e; font-weight: 600; }
  .btn-submit:hover { background: #74c7ec; }
  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .result-success {
    padding: 12px;
    background: #1e3a29;
    border: 1px solid #a6e3a1;
    border-radius: 8px;
    color: #a6e3a1;
    text-align: center;
  }
  .result-error {
    padding: 12px;
    background: #3a1e2e;
    border: 1px solid #f38ba8;
    border-radius: 8px;
    color: #f38ba8;
    text-align: center;
  }
`;

// --- Static HTML ---

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tempest Remote</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="login-container">
    <h1>Tempest Remote</h1>
    <p>Enter your access token to continue.</p>
    <form onsubmit="event.preventDefault(); window.location.href='/?token=' + encodeURIComponent(document.getElementById('t').value);">
      <input id="t" type="password" placeholder="Access token" autofocus>
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`;

function dashboardHTML(
  status: ReturnType<TempestHttpServer["getStatus"]>,
  token: string,
): string {
  const repoSections = status.repos
    .map(({ repo, workspaces }) => {
      const wsRows = workspaces
        .map(({ workspace, activityState }) => {
          const dotColor = statusColor(activityState);
          const dotOpacity = activityState === "idle" ? "0.4" : "1";
          return `<tr data-ws-id="${escapeHtml(workspace.id)}">
            <td class="status-cell"><span class="status-dot" style="background:${dotColor}; opacity:${dotOpacity};"></span></td>
            <td class="ws-name">${escapeHtml(workspace.name)}</td>
            <td class="ws-status">${escapeHtml(activityState)}</td>
            <td class="ws-path">${escapeHtml(workspace.path)}</td>
          </tr>`;
        })
        .join("\n");

      return `<div class="repo-section">
        <div class="repo-header">
          <h2>${escapeHtml(repo.name)}</h2>
          <span class="vcs-badge">${escapeHtml(repo.vcsType)}</span>
          <button class="btn btn-add" onclick="showNewWorkspaceForm('${escapeHtml(repo.id)}', '${escapeHtml(repo.name)}')">+ New Workspace</button>
        </div>
        <table class="ws-table">
          <thead><tr><th></th><th>Workspace</th><th>Status</th><th>Path</th></tr></thead>
          <tbody>${wsRows || '<tr><td colspan="4" class="empty-row">No workspaces</td></tr>'}</tbody>
        </table>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tempest Remote</title>
  <style>${BASE_STYLES}${DASHBOARD_STYLES}</style>
</head>
<body>
  <header>
    <h1>Tempest Remote</h1>
    <span class="refresh-info">Auto-refreshes every 5s</span>
  </header>
  <main>
    ${repoSections || '<p class="empty-state">No repositories configured. Add repos in the Tempest desktop app.</p>'}
  </main>

  <!-- New Workspace Modal -->
  <div id="modal-overlay" class="modal-overlay" style="display:none;" onclick="if(event.target===this)hideModal()">
    <div class="modal">
      <h3>New Workspace in <span id="modal-repo-name"></span></h3>
      <form id="new-ws-form" onsubmit="submitNewWorkspace(event)">
        <input type="hidden" id="modal-repo-id">
        <label for="ws-name">Workspace Name</label>
        <input type="text" id="ws-name" required placeholder="e.g. feature-auth" autofocus autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <label for="ws-prompt">Claude Prompt <span class="optional">(optional)</span></label>
        <textarea id="ws-prompt" rows="6" placeholder="e.g. Implement user authentication using JWT tokens..."></textarea>
        <div class="modal-buttons">
          <button type="button" class="btn btn-cancel" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-submit" id="submit-btn">Create</button>
        </div>
      </form>
      <div id="modal-result" style="display:none;"></div>
    </div>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    const headers = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

    // Auto-refresh status
    setInterval(async () => {
      try {
        const resp = await fetch('/api/status', { headers });
        if (!resp.ok) return;
        const data = await resp.json();
        updateDashboard(data);
      } catch {}
    }, 5000);

    function updateDashboard(data) {
      // Update status dots and labels in-place
      for (const { repo, workspaces } of data.repos) {
        for (const { workspace, activityState } of workspaces) {
          const rows = document.querySelectorAll('tr[data-ws-id="' + workspace.id + '"]');
          rows.forEach(row => {
            const dot = row.querySelector('.status-dot');
            if (dot) {
              dot.style.background = statusColor(activityState);
              dot.style.opacity = activityState === 'idle' ? '0.4' : '1';
            }
            const statusCell = row.querySelector('.ws-status');
            if (statusCell) statusCell.textContent = activityState;
          });
        }
      }
    }

    function statusColor(state) {
      switch (state) {
        case 'working': return '#a6e3a1';
        case 'needsInput': return '#f38ba8';
        case 'exited': return '#f9e2af';
        case 'error': return '#f38ba8';
        default: return '#6c7086';
      }
    }

    function showNewWorkspaceForm(repoId, repoName) {
      document.getElementById('modal-repo-id').value = repoId;
      document.getElementById('modal-repo-name').textContent = repoName;
      document.getElementById('ws-name').value = '';
      document.getElementById('ws-prompt').value = '';
      document.getElementById('modal-result').style.display = 'none';
      document.getElementById('new-ws-form').style.display = 'block';
      document.getElementById('submit-btn').disabled = false;
      document.getElementById('modal-overlay').style.display = 'flex';
      document.getElementById('ws-name').focus();
    }

    function hideModal() {
      document.getElementById('modal-overlay').style.display = 'none';
    }

    async function submitNewWorkspace(event) {
      event.preventDefault();
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      const repoId = document.getElementById('modal-repo-id').value;
      const name = document.getElementById('ws-name').value.trim();
      const prompt = document.getElementById('ws-prompt').value.trim();

      try {
        const resp = await fetch('/api/workspaces', {
          method: 'POST',
          headers,
          body: JSON.stringify({ repoId, name, prompt: prompt || undefined }),
        });
        const result = await resp.json();
        const resultEl = document.getElementById('modal-result');

        if (result.success) {
          resultEl.className = 'result-success';
          resultEl.textContent = 'Workspace "' + name + '" created successfully' + (prompt ? ' — Claude has been prompted.' : '.');
          document.getElementById('new-ws-form').style.display = 'none';
          resultEl.style.display = 'block';
          // Reload the page after a moment to show the new workspace
          setTimeout(() => location.reload(), 2000);
        } else {
          resultEl.className = 'result-error';
          resultEl.textContent = 'Error: ' + (result.error || 'Unknown error');
          resultEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Create';
        }
      } catch (err) {
        const resultEl = document.getElementById('modal-result');
        resultEl.className = 'result-error';
        resultEl.textContent = 'Network error: ' + err.message;
        resultEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    }
  </script>
</body>
</html>`;
}

function statusColor(state: string): string {
  switch (state) {
    case "working": return "#a6e3a1";
    case "needsInput": return "#f38ba8";
    case "exited": return "#f9e2af";
    case "error": return "#f38ba8";
    default: return "#6c7086";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Generate a random bearer token. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}
