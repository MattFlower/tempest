// ============================================================
// PRMonitor — Orchestrates poller, socket server, and draft manager.
// ============================================================

import type { PRMonitorConfig, PRComment, PRDraft } from "./pr-models";
import type { PRDraftSummary } from "../../shared/ipc-types";
import { PRPoller } from "./pr-poller";
import { PRSocketServer } from "./pr-socket-server";
import { DraftManager } from "./draft-manager";
import { HookSettingsBuilder } from "../hooks/hook-settings-builder";
import { PathResolver } from "../config/path-resolver";

interface MonitorState {
  config: PRMonitorConfig;
  poller: PRPoller;
  storedComments: Map<string, PRComment>;
  lastPoll: string | null;
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

        // Use full workspace path as the channel key to avoid collisions
        // between same-named workspaces in different repos.
        this.socketServer.sendEvent(
          workspacePath,
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

    poller.onPollComplete = (workspacePath) => {
      const monitor = this.monitors.get(workspacePath);
      if (monitor) {
        monitor.lastPoll = new Date().toISOString();
      }
    };

    const state: MonitorState = { config, poller, storedComments, lastPoll: null };
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

  /** Force an immediate poll (e.g. "Check Now" button). */
  async pollNow(workspacePath: string): Promise<void> {
    const monitor = this.monitors.get(workspacePath);
    if (!monitor) return;
    await monitor.poller.pollNow(monitor.config);
  }

  /** Get last poll timestamp for a workspace. */
  getLastPoll(workspacePath: string): string | null {
    return this.monitors.get(workspacePath)?.lastPoll ?? null;
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

    // Mark as approved (user intent), then attempt to post
    this.draftManager.approveDraft(draftId);

    try {
      await this.postReplyToGitHub(draft);
      this.draftManager.markSent(draftId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.draftManager.markFailed(draftId, message);
      return { success: false, error: message };
    }
  }

  updateDraftText(draftId: string, text: string): void {
    this.draftManager.updateDraftText(draftId, text);
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

  private findMonitorByWorkspace(workspaceKey: string): MonitorState | null {
    // Preferred key: full workspace path (sent URL-encoded by tempest-channel.ts).
    const direct = this.monitors.get(workspaceKey);
    if (direct) return direct;

    // Backward-compat fallback for older sessions that used basename only.
    for (const [workspacePath, monitor] of this.monitors) {
      const name = workspacePath.split("/").pop() ?? "";
      if (name === workspaceKey) return monitor;
    }

    return null;
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

    const ghPath = new PathResolver().resolve("gh");

    const repo = `${monitor.config.owner}/${monitor.config.repo}`;

    const commentId = stored.commentId;

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
    commitRef: draft.commitRef,
    createdAt: draft.createdAt,
    status: draft.status,
    failureMessage: draft.failureMessage,
    originalAuthor: draft.originalAuthor,
    originalBody: draft.originalBody,
    originalPath: draft.originalPath,
    originalLine: draft.originalLine,
  };
}
