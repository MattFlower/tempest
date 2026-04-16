// ============================================================
// PRPoller — Polls GitHub for new PR review comments.
// Port of PRPoller.swift.
// ============================================================

import type {
  PRMonitorConfig,
  PRComment,
  GitHubReviewComment,
  GraphQLReviewThreadsResponse,
} from "./pr-models";
import { PathResolver } from "../config/path-resolver";

const pathResolver = new PathResolver();

export class PRPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly interval: number;
  private seenNodeIds = new Set<string>();
  private currentUser: string | null = null;

  /** Called when new, unseen, unresolved comments are found. */
  onNewComments:
    | ((workspacePath: string, comments: PRComment[]) => void)
    | null = null;

  /** Called after every poll attempt completes (success or failure). */
  onPollComplete: ((workspacePath: string) => void) | null = null;

  constructor(interval: number = 60_000) {
    this.interval = interval;
  }

  async startPolling(config: PRMonitorConfig): Promise<void> {
    this.stopPolling();

    // Fetch current user once so we can filter out our own comments
    if (!this.currentUser) {
      this.currentUser = await this.fetchCurrentUser();
    }

    // Poll immediately, then on interval
    this.poll(config);
    this.timer = setInterval(() => this.poll(config), this.interval);
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate poll (e.g. "Check Now" button). */
  async pollNow(config: PRMonitorConfig): Promise<void> {
    await this.poll(config);
  }

  /** Reset seen IDs (useful when switching PRs). */
  reset(): void {
    this.seenNodeIds.clear();
    this.currentUser = null;
  }

  // --- Pure functions exposed for testing ---

  static filterNew(
    comments: GitHubReviewComment[],
    seen: Set<string>,
    currentUser: string,
    resolvedNodeIds: Set<string> = new Set(),
  ): GitHubReviewComment[] {
    return comments.filter(
      (c) =>
        !seen.has(c.node_id) &&
        c.user.login !== currentUser &&
        !resolvedNodeIds.has(c.node_id),
    );
  }

  static toStoredComment(c: GitHubReviewComment): PRComment {
    return {
      nodeId: c.node_id,
      commentId: c.id,
      author: c.user.login,
      body: c.body,
      path: c.path,
      line: c.line,
      diffHunk: c.diff_hunk,
      createdAt: c.created_at,
      url: c.html_url,
    };
  }

  static parseComments(jsonStr: string): GitHubReviewComment[] {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  static parseResolvedNodeIds(jsonStr: string): Set<string> {
    const ids = new Set<string>();
    try {
      const response: GraphQLReviewThreadsResponse = JSON.parse(jsonStr);
      for (const thread of response.data.repository.pullRequest.reviewThreads
        .nodes) {
        if (thread.isResolved) {
          for (const comment of thread.comments.nodes) {
            ids.add(comment.id);
          }
        }
      }
    } catch {
      // If GraphQL fails, don't filter — better to show than to miss
    }
    return ids;
  }

  // --- Private ---

  private async poll(config: PRMonitorConfig): Promise<void> {
    try {
      const ghPath = this.resolveGh();
      const repo = `${config.owner}/${config.repo}`;

      const output = await this.runGh(ghPath, [
        "api",
        `repos/${repo}/pulls/${config.prNumber}/comments`,
        "--paginate",
      ]);

      let comments = PRPoller.parseComments(output);

      // Filter resolved threads via GraphQL
      const resolved = await this.fetchResolvedNodeIds(
        ghPath,
        config.owner,
        config.repo,
        config.prNumber,
      );

      const newComments = PRPoller.filterNew(
        comments,
        this.seenNodeIds,
        this.currentUser ?? "",
        resolved,
      );

      // Mark all as seen (including ones we filtered)
      for (const c of comments) {
        this.seenNodeIds.add(c.node_id);
      }

      if (newComments.length > 0) {
        const stored = newComments.map(PRPoller.toStoredComment);
        this.onNewComments?.(config.workspacePath, stored);
      }
    } catch (err) {
      // Silently skip failed polls — will retry next interval
      console.error("[PRPoller] poll failed:", err);
    } finally {
      this.onPollComplete?.(config.workspacePath);
    }
  }

  private async fetchResolvedNodeIds(
    ghPath: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Set<string>> {
    const query = `query {
  repository(owner: "${owner}", name: "${repo}") {
    pullRequest(number: ${prNumber}) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 100) {
            nodes { id }
          }
        }
      }
    }
  }
}`;

    try {
      const output = await this.runGh(ghPath, [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
      ]);
      return PRPoller.parseResolvedNodeIds(output);
    } catch {
      return new Set();
    }
  }

  private async fetchCurrentUser(): Promise<string> {
    try {
      const ghPath = this.resolveGh();
      const output = await this.runGh(ghPath, ["api", "user", "--jq", ".login"]);
      return output.trim();
    } catch {
      return "";
    }
  }

  private resolveGh(): string {
    return pathResolver.resolve("gh");
  }

  private async runGh(ghPath: string, args: string[]): Promise<string> {
    const proc = Bun.spawn([ghPath, ...args], {
      cwd: process.env.HOME || "/tmp",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(
        `gh ${args.join(" ")} failed (exit ${proc.exitCode}): ${stderr}`,
      );
    }
    return stdout;
  }
}
