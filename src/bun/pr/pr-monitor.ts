// ============================================================
// PRMonitor — Orchestrates poller, socket server, and draft manager.
// ============================================================

import type { PRMonitorConfig, PRComment, PRDraft } from "./pr-models";
import type { PRDraftSummary } from "../../shared/ipc-types";
import { PRPoller } from "./pr-poller";
import { PRSocketServer } from "./pr-socket-server";
import { DraftManager } from "./draft-manager";
import { HookSettingsBuilder } from "../hooks/hook-settings-builder";

interface MonitorState {
  config: PRMonitorConfig;
  poller: PRPoller;
  storedComments: Map<string, PRComment>;
}

export class PRMonitor {
  private monitors = new Map<string, MonitorState>();
  private socketServer: PRSocketServer;
  private draftManager = new DraftManager();

  /** Called when drafts change — used to push updates to webview. */
  onDraftsChanged: ((workspacePath: string) => void) | null = null;

  constructor() {
    this.socketServer = new PRSocketServer(HookSettingsBuilder.socketPath);

    // Wire draft reception from socket server
    this.socketServer.onDraftReceived = (workspace, body) => {
      const monitor = this.findMonitorByWorkspace(workspace);
      if (!monitor) {
        console.warn(
          `[PRMonitor] received draft for unknown workspace: ${workspace}`,
        );
        return;
      }

      this.draftManager.addDraft(
        body,
        monitor.config.workspacePath,
        monitor.storedComments,
      );
      this.onDraftsChanged?.(monitor.config.workspacePath);
    };

    // Forward draft change notifications
    this.draftManager.onDraftsChanged = () => {
      // Notify all active workspaces
      for (const [workspacePath] of this.monitors) {
        this.onDraftsChanged?.(workspacePath);
      }
    };
  }

  /** Start monitoring a PR. Only one PR per workspace at a time. */
  async startMonitor(config: PRMonitorConfig): Promise<void> {
    // Stop existing monitor for this workspace
    this.stopMonitor(config.workspacePath);

    // Ensure socket server is running
    if (!this.isSocketServerRunning()) {
      try {
        this.socketServer.start();
      } catch (err) {
        console.error("[PRMonitor] socket server start failed:", err);
        throw err;
      }
    }

    const poller = new PRPoller();
    const storedComments = new Map<string, PRComment>();

    // Wire new comments: store them and push via SSE
    poller.onNewComments = (workspacePath, comments) => {
      const monitor = this.monitors.get(workspacePath);
      if (!monitor) return;

      for (const comment of comments) {
        monitor.storedComments.set(comment.nodeId, comment);

        // Derive workspace name from path (last component)
        const workspaceName =
          workspacePath.split("/").pop() ?? "default";

        this.socketServer.sendEvent(
          workspaceName,
          "new_comment",
          JSON.stringify({
            node_id: comment.nodeId,
            author: comment.author,
            body: comment.body,
            path: comment.path ?? "",
            line: comment.line ?? null,
            diff_hunk: comment.diffHunk ?? "",
            url: comment.url,
          }),
        );
      }
    };

    const state: MonitorState = { config, poller, storedComments };
    this.monitors.set(config.workspacePath, state);

    await poller.startPolling(config);
    console.log(
      `[PRMonitor] started monitoring PR #${config.prNumber} for ${config.owner}/${config.repo}`,
    );
  }

  stopMonitor(workspacePath: string): void {
    const monitor = this.monitors.get(workspacePath);
    if (!monitor) return;

    monitor.poller.stopPolling();
    this.draftManager.clear(workspacePath);
    this.monitors.delete(workspacePath);

    // If no more monitors, stop the socket server
    if (this.monitors.size === 0) {
      this.socketServer.stop();
    }

    console.log(`[PRMonitor] stopped monitoring for ${workspacePath}`);
  }

  /** Get active monitor config for a workspace (null if not monitoring). */
  getMonitorConfig(workspacePath: string): PRMonitorConfig | null {
    return this.monitors.get(workspacePath)?.config ?? null;
  }

  // --- Draft management (delegates to DraftManager) ---

  getDrafts(workspacePath: string): PRDraftSummary[] {
    return this.draftManager.getDrafts(workspacePath).map(toDraftSummary);
  }

  async approveDraft(
    draftId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const draft = this.draftManager.getDraftById(draftId);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    // Post the reply to GitHub
    try {
      await this.postReplyToGitHub(draft);
      this.draftManager.approveDraft(draftId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  dismissDraft(draftId: string, abandon: boolean): void {
    this.draftManager.dismissDraft(draftId);
    if (abandon) {
      // TODO: could trigger undo of code changes (revert commit)
      console.log(`[PRMonitor] dismissed draft ${draftId} with abandon`);
    }
  }

  // --- Shutdown ---

  shutdown(): void {
    for (const [workspacePath] of this.monitors) {
      this.stopMonitor(workspacePath);
    }
    this.socketServer.stop();
  }

  // --- Private ---

  private isSocketServerRunning(): boolean {
    // Check by attempting to see if the server object exists
    return (this.socketServer as any).server !== null;
  }

  private findMonitorByWorkspace(workspaceName: string): MonitorState | null {
    // The workspace name from the socket path is the last component of workspacePath
    for (const [workspacePath, monitor] of this.monitors) {
      const name = workspacePath.split("/").pop() ?? "";
      if (name === workspaceName) return monitor;
    }
    // Fallback: try the workspace name directly
    return this.monitors.get(workspaceName) ?? null;
  }

  private async postReplyToGitHub(draft: PRDraft): Promise<void> {
    // Find the monitor for this draft's workspace
    const monitor = this.monitors.get(draft.workspacePath);
    if (!monitor) {
      throw new Error("No active monitor for this workspace");
    }

    const stored = monitor.storedComments.get(draft.nodeId);
    if (!stored) {
      throw new Error("Original comment not found in stored comments");
    }

    const ghPath = Bun.which("gh");
    if (!ghPath) throw new Error("gh CLI not found");

    const repo = `${monitor.config.owner}/${monitor.config.repo}`;

    // Use the REST API to reply to a pull request review comment
    // The comment ID from the stored comment is needed (numeric ID)
    // We need to extract it from the stored comment. The nodeId is the GraphQL ID,
    // but we need the REST API numeric ID. We stored the GitHub URL which contains it.
    const commentIdMatch = stored.url.match(/comments\/(\d+)/);
    if (!commentIdMatch) {
      throw new Error("Could not extract comment ID from URL");
    }
    const commentId = commentIdMatch[1];

    const body = JSON.stringify({ body: draft.replyText });

    const proc = Bun.spawn(
      [
        ghPath,
        "api",
        `repos/${repo}/pulls/${monitor.config.prNumber}/comments/${commentId}/replies`,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      {
        cwd: process.env.HOME || "/tmp",
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      },
    );

    proc.stdin.write(body);
    proc.stdin.end();

    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    if (proc.exitCode !== 0) {
      throw new Error(`gh api failed (exit ${proc.exitCode}): ${stderr}`);
    }
  }
}

function toDraftSummary(draft: PRDraft): PRDraftSummary {
  return {
    id: draft.id,
    nodeId: draft.nodeId,
    replyText: draft.replyText,
    hasCodeChange: draft.hasCodeChange,
    commitDescription: draft.commitDescription,
    createdAt: draft.createdAt,
    status: draft.status,
    originalAuthor: draft.originalAuthor,
    originalBody: draft.originalBody,
    originalPath: draft.originalPath,
  };
}
