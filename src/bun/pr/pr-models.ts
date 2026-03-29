// ============================================================
// PR Feedback System — type definitions
// ============================================================

export interface PRMonitorConfig {
  workspacePath: string;
  prNumber: number;
  prURL: string;
  owner: string;
  repo: string;
}

export interface PRComment {
  nodeId: string;
  commentId: number; // REST API numeric ID
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  url: string;
  diffHunk?: string;
}

export interface PRDraft {
  id: string;
  workspacePath: string;
  nodeId: string; // PR comment node ID this replies to
  replyText: string;
  hasCodeChange: boolean;
  commitDescription?: string;
  commitRef?: string;
  createdAt: string;
  status: "pending" | "approved" | "sent" | "failed" | "dismissed";
  failureMessage?: string;
  // Original comment context
  originalAuthor?: string;
  originalBody?: string;
  originalPath?: string;
  originalLine?: number;
}

/** Body POSTed by the TempestChannel MCP server when submitting a draft */
export interface DraftPostBody {
  node_id: string;
  reply_text: string;
  has_code_change: boolean;
  commit_description?: string | null;
  commit_ref?: string | null;
}

// --- GitHub API response shapes ---

export interface GitHubReviewComment {
  id: number;
  node_id: string;
  user: { login: string };
  body: string;
  path?: string;
  line?: number;
  diff_hunk?: string;
  created_at: string;
  html_url: string;
}

// GraphQL response for resolved thread detection
export interface GraphQLReviewThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{
            isResolved: boolean;
            comments: {
              nodes: Array<{ id: string }>;
            };
          }>;
        };
      };
    };
  };
}
