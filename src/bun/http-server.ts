import { randomBytes } from "node:crypto";
import type { ServerWebSocket } from "bun";
import type { WorkspaceManager } from "./workspace-manager";
import type { SessionActivityTracker } from "./hooks/session-activity-tracker";
import type { PtyManager } from "./pty-manager";
import type { SessionStateManager } from "./session-state-manager";
import type { RemoteTerminalHub, TermWsData } from "./remote-terminal-hub";
import { ActivityState } from "../shared/ipc-types";
import type {
  AppConfig,
  HttpServerConfig,
  PaneNodeState,
  SourceRepo,
  TempestWorkspace,
} from "../shared/ipc-types";

export interface HttpServerDeps {
  workspaceManager: WorkspaceManager;
  activityTracker: SessionActivityTracker;
  getConfig: () => Promise<AppConfig>;
  ptyManager: PtyManager;
  sessionStateManager: SessionStateManager;
  scrollbackCache: Map<string, { scrollback: string; cwd?: string }>;
  remoteHub: RemoteTerminalHub;
}

interface RemoteTerminalInfo {
  id: string;
  kind: string;
  label: string;
  sessionID?: string;
  running: boolean;
  hasScrollback: boolean;
}

// Pending data queued by the HTTP server, consumed by TerminalPane when
// the workspace is first opened in the UI and a Claude terminal is created.
interface PendingWorkspaceData {
  prompt?: string;
  planMode?: boolean;
}

const pendingData = new Map<string, PendingWorkspaceData>();

export function queuePendingData(workspacePath: string, data: PendingWorkspaceData): void {
  pendingData.set(workspacePath, data);
}

export function consumePendingData(workspacePath: string): PendingWorkspaceData | undefined {
  const data = pendingData.get(workspacePath);
  if (data !== undefined) pendingData.delete(workspacePath);
  return data;
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
      this.server = Bun.serve<TermWsData>({
        port: this.port,
        hostname: this.hostname,
        fetch: (req, server) => this.handleRequest(req, server),
        websocket: {
          open: (ws) => this.onWsOpen(ws),
          message: (ws, msg) => this.onWsMessage(ws, msg),
          close: (ws) => this.onWsClose(ws),
        },
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

  private async handleRequest(
    req: Request,
    server: ReturnType<typeof Bun.serve>,
  ): Promise<Response | undefined> {
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
        return new Response(await this.renderDashboard(), {
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
          planMode?: boolean;
        };
        return Response.json(await this.createWorkspaceAndPrompt(body));
      }

      // API: list running terminals in a workspace
      if (path === "/api/terminals" && req.method === "GET") {
        const config = await this.deps.getConfig();
        if (config.httpAllowTerminalConnect !== true) {
          return Response.json(
            { error: "Terminal connect is disabled" },
            { status: 403 },
          );
        }
        const workspacePath = url.searchParams.get("workspacePath");
        if (!workspacePath) {
          return Response.json({ error: "workspacePath required" }, { status: 400 });
        }
        return Response.json({ terminals: this.listTerminals(workspacePath) });
      }

      // Terminal viewer HTML
      if (path === "/terminal" && req.method === "GET") {
        const config = await this.deps.getConfig();
        if (config.httpAllowTerminalConnect !== true) {
          return new Response("Terminal connect is disabled", { status: 403 });
        }
        const terminalId = url.searchParams.get("id");
        if (!terminalId) {
          return new Response("Missing id parameter", { status: 400 });
        }
        const allowWrite = config.httpAllowTerminalWrite === true;
        return new Response(terminalViewerHTML(terminalId, this.token, allowWrite), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // WebSocket upgrade for terminal stream
      if (path.startsWith("/ws/terminals/")) {
        const config = await this.deps.getConfig();
        if (config.httpAllowTerminalConnect !== true) {
          return new Response("Terminal connect is disabled", { status: 403 });
        }
        const terminalId = decodeURIComponent(path.slice("/ws/terminals/".length));
        if (!terminalId) {
          return new Response("Missing terminal id", { status: 400 });
        }
        if (!this.deps.ptyManager.isRunning(terminalId)) {
          return new Response("Terminal not running", { status: 404 });
        }
        const allowWrite = config.httpAllowTerminalWrite === true;
        const upgraded = server.upgrade(req, {
          data: { terminalId, allowWrite } satisfies TermWsData,
        });
        if (upgraded) return undefined;
        return new Response("Upgrade failed", { status: 400 });
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
    planMode?: boolean;
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

    // Resolve planMode: explicit request param > config default > false
    const config = await this.deps.getConfig();
    const planMode = params.planMode ?? config.httpDefaultPlanMode ?? false;

    // Queue prompt and mode — consumed when the workspace is opened
    // in the UI and the Claude terminal is lazily initialized.
    const prompt = params.prompt?.trim();
    if (prompt || planMode) {
      queuePendingData(workspace.path, { prompt, planMode: planMode || undefined });
    }

    // Auto-select the workspace in the UI so the terminal initializes
    this.onSelectWorkspace?.(workspace.path);

    return {
      success: true,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      error: result.error, // propagate prepare-script errors
    };
  }

  private listTerminals(workspacePath: string): RemoteTerminalInfo[] {
    const tree = this.deps.sessionStateManager.getPaneState(workspacePath);
    if (!tree) return [];
    const out: RemoteTerminalInfo[] = [];
    const walk = (node: PaneNodeState | null | undefined): void => {
      if (!node) return;
      if (node.type === "leaf") {
        for (const tab of node.pane.tabs) {
          if (
            tab.kind !== "claude" &&
            tab.kind !== "shell" &&
            tab.kind !== "pi"
          ) continue;
          if (!tab.terminalId) continue;
          out.push({
            id: tab.terminalId,
            kind: tab.kind,
            label: tab.label ?? tab.kind,
            sessionID: tab.sessionID ?? tab.sessionId,
            running: this.deps.ptyManager.isRunning(tab.terminalId),
            hasScrollback: this.deps.scrollbackCache.has(tab.terminalId),
          });
        }
      } else if (node.type === "split") {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
    return out;
  }

  private onWsOpen(ws: ServerWebSocket<TermWsData>): void {
    const { terminalId } = ws.data;
    this.deps.remoteHub.attach(terminalId, ws);
    const cached = this.deps.scrollbackCache.get(terminalId);
    const initFrame = {
      type: "init",
      terminalId,
      allowWrite: ws.data.allowWrite,
      scrollback: cached?.scrollback ?? "",
      cwd: cached?.cwd,
    };
    try {
      ws.send(JSON.stringify(initFrame));
    } catch {
      // ignore
    }
  }

  private onWsMessage(
    ws: ServerWebSocket<TermWsData>,
    msg: string | Buffer,
  ): void {
    const { terminalId, allowWrite } = ws.data;
    if (!allowWrite) return;
    let parsed: any;
    try {
      parsed = JSON.parse(typeof msg === "string" ? msg : msg.toString("utf-8"));
    } catch {
      return;
    }
    if (parsed?.type === "input" && typeof parsed.data === "string") {
      this.deps.ptyManager.write(terminalId, parsed.data);
    } else if (
      parsed?.type === "resize" &&
      typeof parsed.cols === "number" &&
      typeof parsed.rows === "number"
    ) {
      this.deps.ptyManager.resize(terminalId, parsed.cols, parsed.rows);
    }
  }

  private onWsClose(ws: ServerWebSocket<TermWsData>): void {
    this.deps.remoteHub.detach(ws.data.terminalId, ws);
  }

  private async renderDashboard(): Promise<string> {
    const status = this.getStatus();
    const config = await this.deps.getConfig();
    const allowConnect = config.httpAllowTerminalConnect === true;
    return dashboardHTML(status, this.token, allowConnect);
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
  .btn-connect {
    background: #313244;
    color: #a6e3a1;
    font-size: 0.8rem;
    padding: 4px 10px;
  }
  .btn-connect:hover { background: #45475a; }
  .ws-connect { text-align: right; width: 100px; }
  .term-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .term-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid #313244;
    border-radius: 8px;
    margin-bottom: 6px;
    background: #181825;
  }
  .term-list li.clickable { cursor: pointer; }
  .term-list li.clickable:hover { background: #1e1e2e; border-color: #45475a; }
  .term-list li.dead { opacity: 0.5; }
  .term-kind-badge {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
  .term-kind-claude { background: #1e3a29; color: #a6e3a1; }
  .term-kind-shell { background: #313244; color: #89b4fa; }
  .term-kind-pi { background: #2e1e3a; color: #cba6f7; }
  .term-label { flex: 1; color: #cdd6f4; font-size: 0.9rem; }
  .term-session { color: #585b70; font-size: 0.75rem; font-family: monospace; }
  .term-status { color: #6c7086; font-size: 0.75rem; }
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
  allowConnect: boolean,
): string {
  const repoSections = status.repos
    .map(({ repo, workspaces }) => {
      const wsRows = workspaces
        .map(({ workspace, activityState }) => {
          const dotColor = statusColor(activityState);
          const dotOpacity = activityState === "idle" ? "0.4" : "1";
          const connectCell = allowConnect
            ? `<td class="ws-connect">
              <button class="btn btn-connect" onclick="showTerminals('${escapeHtml(workspace.path)}', '${escapeHtml(workspace.name)}')">Connect</button>
            </td>`
            : `<td class="ws-connect"></td>`;
          return `<tr data-ws-id="${escapeHtml(workspace.id)}">
            <td class="status-cell"><span class="status-dot" style="background:${dotColor}; opacity:${dotOpacity};"></span></td>
            <td class="ws-name">${escapeHtml(workspace.name)}</td>
            <td class="ws-status">${escapeHtml(activityState)}</td>
            <td class="ws-path">${escapeHtml(workspace.path)}</td>
            ${connectCell}
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
          <thead><tr><th></th><th>Workspace</th><th>Status</th><th>Path</th><th></th></tr></thead>
          <tbody>${wsRows || '<tr><td colspan="5" class="empty-row">No workspaces</td></tr>'}</tbody>
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

  <!-- Terminal Picker Modal -->
  <div id="term-modal-overlay" class="modal-overlay" style="display:none;" onclick="if(event.target===this)hideTermModal()">
    <div class="modal">
      <h3>Terminals in <span id="term-modal-ws-name"></span></h3>
      <div id="term-modal-body">
        <p style="color:#6c7086; font-size:0.9rem;">Loading...</p>
      </div>
      <div class="modal-buttons">
        <button type="button" class="btn btn-cancel" onclick="hideTermModal()">Close</button>
      </div>
    </div>
  </div>

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
        <div style="margin-top:12px; display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="ws-plan-mode" style="accent-color:#89b4fa; width:16px; height:16px;">
          <label for="ws-plan-mode" style="font-size:0.85rem; color:#cdd6f4; margin:0; cursor:pointer;">Start in plan mode</label>
        </div>
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
      document.getElementById('ws-plan-mode').checked = false;
      document.getElementById('modal-result').style.display = 'none';
      document.getElementById('new-ws-form').style.display = 'block';
      document.getElementById('submit-btn').disabled = false;
      document.getElementById('modal-overlay').style.display = 'flex';
      document.getElementById('ws-name').focus();
    }

    function hideModal() {
      document.getElementById('modal-overlay').style.display = 'none';
    }

    function hideTermModal() {
      document.getElementById('term-modal-overlay').style.display = 'none';
    }

    async function showTerminals(workspacePath, workspaceName) {
      document.getElementById('term-modal-ws-name').textContent = workspaceName;
      const body = document.getElementById('term-modal-body');
      body.innerHTML = '<p style="color:#6c7086; font-size:0.9rem;">Loading...</p>';
      document.getElementById('term-modal-overlay').style.display = 'flex';

      try {
        const resp = await fetch('/api/terminals?workspacePath=' + encodeURIComponent(workspacePath), { headers });
        const data = await resp.json();
        const terms = (data && data.terminals) || [];
        if (terms.length === 0) {
          body.innerHTML = '<p style="color:#6c7086; font-size:0.9rem;">No terminals in this workspace. Open the workspace in Tempest to start one.</p>';
          return;
        }
        const items = terms.map(t => {
          const badgeClass =
            t.kind === 'claude' ? 'term-kind-claude' :
            t.kind === 'pi'     ? 'term-kind-pi' :
                                  'term-kind-shell';
          const kindLabel = t.kind;
          const sessionStr = t.sessionID ? ('<span class="term-session">' + escapeAttr(t.sessionID.slice(0, 8)) + '</span>') : '';
          const statusStr = t.running ? 'running' : 'stopped';
          const liClass = 'term-list-item' + (t.running ? ' clickable' : ' dead');
          const onclick = t.running
            ? 'onclick="connectTerminal(\\'' + escapeAttr(t.id) + '\\')"'
            : '';
          return '<li class="' + liClass + '" ' + onclick + '>' +
            '<span class="term-kind-badge ' + badgeClass + '">' + escapeAttr(kindLabel) + '</span>' +
            '<span class="term-label">' + escapeAttr(t.label) + '</span>' +
            sessionStr +
            '<span class="term-status">' + statusStr + '</span>' +
            '</li>';
        }).join('');
        body.innerHTML = '<ul class="term-list">' + items + '</ul>';
      } catch (err) {
        body.innerHTML = '<p class="result-error">Failed to load terminals: ' + escapeAttr(String(err)) + '</p>';
      }
    }

    function connectTerminal(terminalId) {
      const url = '/terminal?token=' + encodeURIComponent(TOKEN) + '&id=' + encodeURIComponent(terminalId);
      window.open(url, '_blank');
    }

    function escapeAttr(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function submitNewWorkspace(event) {
      event.preventDefault();
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      const repoId = document.getElementById('modal-repo-id').value;
      const name = document.getElementById('ws-name').value.trim();
      const prompt = document.getElementById('ws-prompt').value.trim();
      const planMode = document.getElementById('ws-plan-mode').checked;

      try {
        const resp = await fetch('/api/workspaces', {
          method: 'POST',
          headers,
          body: JSON.stringify({ repoId, name, prompt: prompt || undefined, planMode: planMode || undefined }),
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

function terminalViewerHTML(
  terminalId: string,
  token: string,
  allowWrite: boolean,
): string {
  const XTERM_VERSION = "5.5.0";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tempest Remote — Terminal</title>
  <link rel="stylesheet" href="https://unpkg.com/@xterm/xterm@${XTERM_VERSION}/css/xterm.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #000; color: #cdd6f4; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    #topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: #1e1e2e;
      border-bottom: 1px solid #313244;
      font-size: 0.85rem;
    }
    #topbar .title { color: #89b4fa; font-weight: 600; }
    #topbar .mode {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .mode-ro { background: #3a1e2e; color: #f9e2af; }
    .mode-rw { background: #1e3a29; color: #a6e3a1; }
    #status { color: #6c7086; margin-left: auto; }
    #term-host {
      position: absolute;
      top: 38px;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 6px;
    }
    .xterm { height: 100%; }
  </style>
</head>
<body>
  <div id="topbar">
    <span class="title">Tempest Remote</span>
    <span>Terminal: <code>${escapeHtml(terminalId)}</code></span>
    <span class="mode ${allowWrite ? "mode-rw" : "mode-ro"}">${allowWrite ? "read-write" : "view-only"}</span>
    <span id="status">connecting...</span>
  </div>
  <div id="term-host"></div>

  <script src="https://unpkg.com/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js"></script>
  <script src="https://unpkg.com/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
  <script>
    const TERMINAL_ID = ${JSON.stringify(terminalId)};
    const TOKEN = ${JSON.stringify(token)};
    const ALLOW_WRITE = ${JSON.stringify(allowWrite)};
    const statusEl = document.getElementById('status');

    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#000000' },
      convertEol: false,
      disableStdin: !ALLOW_WRITE,
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('term-host'));
    fitAddon.fit();

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + location.host + '/ws/terminals/' + encodeURIComponent(TERMINAL_ID) + '?token=' + encodeURIComponent(TOKEN);
    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      statusEl.textContent = 'connected';
      statusEl.style.color = '#a6e3a1';
    });

    ws.addEventListener('message', (ev) => {
      let frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (frame.type === 'init') {
        if (frame.scrollback) term.write(frame.scrollback);
        // After replaying scrollback, report our dimensions so the PTY matches the viewer.
        if (ALLOW_WRITE) sendResize();
      } else if (frame.type === 'output') {
        // Base64 -> binary -> utf-8 string
        const bin = atob(frame.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        term.write(new TextDecoder().decode(bytes));
      } else if (frame.type === 'exit') {
        statusEl.textContent = 'terminal exited (code ' + frame.exitCode + ')';
        statusEl.style.color = '#f38ba8';
      }
    });

    ws.addEventListener('close', () => {
      statusEl.textContent = 'disconnected';
      statusEl.style.color = '#f38ba8';
    });

    ws.addEventListener('error', () => {
      statusEl.textContent = 'connection error';
      statusEl.style.color = '#f38ba8';
    });

    if (ALLOW_WRITE) {
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });
    }

    function sendResize() {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }

    window.addEventListener('resize', () => {
      fitAddon.fit();
      if (ALLOW_WRITE) sendResize();
    });
  </script>
</body>
</html>`;
}
