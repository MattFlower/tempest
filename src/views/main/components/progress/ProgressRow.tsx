import { useCallback, type ReactNode } from "react";
import { PaneTabKind, ViewMode, WorkspaceStage } from "../../../../shared/ipc-types";
import type { WorkspaceProgressInfo } from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";
import { createTab, allPanes } from "../../models/pane-node";
import { addTab } from "../../state/actions";
import { api } from "../../state/rpc-client";
import { ProgressRowDetail } from "./ProgressRowDetail";

interface Props {
  workspace: WorkspaceProgressInfo;
  expanded: boolean;
  onToggleExpand: () => void;
  onArchived: () => void;
  onRefresh: () => void;
}

function navigateToWorkspace(wsPath: string, viewMode: ViewMode) {
  const store = useStore.getState();
  store.selectWorkspace(wsPath);
  store.setViewMode(wsPath, viewMode);
  store.setProgressViewActive(false);
}

function openUrlInWorkspace(wsPath: string, url: string, label: string) {
  const store = useStore.getState();
  store.selectWorkspace(wsPath);
  store.setViewMode(wsPath, ViewMode.Terminal);
  store.setProgressViewActive(false);

  // Wait for the workspace's pane tree to be initialized
  // (happens in WorkspaceDetail's useEffect after React render)
  const tryAddTab = () => {
    const state = useStore.getState();
    const tree = state.paneTrees[wsPath];
    if (!tree || state.selectedWorkspacePath !== wsPath) return false;

    // Always resolve the pane from the target workspace's tree
    const panes = allPanes(tree);
    const paneId = panes[0]?.id;
    if (!paneId) return false;

    // Ensure focusedPaneId points to a pane in this workspace
    state.setFocusedPaneId(paneId);

    const tab = createTab(PaneTabKind.Browser, label, { browserURL: url });
    addTab(paneId, tab);
    return true;
  };

  // If pane tree already exists, add immediately
  if (tryAddTab()) return;

  // Otherwise subscribe to store changes and add once ready
  const unsub = useStore.subscribe(() => {
    if (tryAddTab()) unsub();
  });

  // Safety: clean up after 5s if it never resolves
  setTimeout(() => unsub(), 5000);
}

function Age({ createdAt }: { createdAt?: string }) {
  if (!createdAt) return null;
  return (
    <span style={{ color: "var(--ctp-overlay1)" }}>
      {formatRelativeTime(createdAt)}
    </span>
  );
}

function Sep() {
  return <span style={{ color: "var(--ctp-overlay1)" }}> · </span>;
}

// Build the one-line summary text for each stage
function SummaryText({ ws }: { ws: WorkspaceProgressInfo }) {
  const { stage, diffStats, prDetail } = ws;

  if (stage === WorkspaceStage.New) {
    return (
      <>
        <Age createdAt={ws.createdAt} />
        {ws.createdAt && <Sep />}
        <span style={{ color: "var(--ctp-overlay1)" }}>No changes yet</span>
      </>
    );
  }

  if (stage === WorkspaceStage.InDevelopment) {
    return (
      <>
        <Age createdAt={ws.createdAt} />
        {ws.createdAt && diffStats && <Sep />}
        {diffStats && (
          <>
            <span style={{ color: "var(--ctp-green)" }}>
              +{diffStats.additions}
            </span>{" "}
            <span style={{ color: "var(--ctp-red)" }}>
              &minus;{diffStats.deletions}
            </span>
          </>
        )}
      </>
    );
  }

  if (stage === WorkspaceStage.PullRequest && prDetail) {
    const parts: ReactNode[] = [];

    if (ws.createdAt) {
      parts.push(
        <span key="age" style={{ color: "var(--ctp-overlay1)" }}>
          {formatRelativeTime(ws.createdAt)}
        </span>,
      );
    }

    if (prDetail.checksFailed > 0) {
      parts.push(
        <span key="cf" style={{ color: "var(--ctp-red)", fontWeight: 500 }}>
          {prDetail.checksFailed} failed check
          {prDetail.checksFailed > 1 ? "s" : ""}
        </span>,
      );
    }
    if (prDetail.reviewSummary.changesRequested > 0) {
      parts.push(
        <span key="cr" style={{ color: "var(--ctp-red)", fontWeight: 500 }}>
          {prDetail.reviewSummary.changesRequested} changes requested
        </span>,
      );
    }
    if (prDetail.comments.noResponse > 0) {
      parts.push(
        <span key="nr" style={{ color: "var(--ctp-red)", fontWeight: 500 }}>
          {prDetail.comments.noResponse} no response
        </span>,
      );
    }
    if (prDetail.comments.unresolved > 0) {
      parts.push(
        <span key="ur" style={{ color: "var(--ctp-peach)", fontWeight: 500 }}>
          {prDetail.comments.unresolved} unresolved
        </span>,
      );
    }
    if (prDetail.reviewSummary.approved > 0) {
      parts.push(
        <span key="ap" style={{ color: "var(--ctp-green)" }}>
          ✓ {prDetail.reviewSummary.approved} approved
        </span>,
      );
    }
    if (prDetail.checksPassed > 0 && prDetail.checksFailed === 0) {
      parts.push(
        <span key="cp" style={{ color: "var(--ctp-green)" }}>
          {prDetail.checksPassed} checks passed
        </span>,
      );
    }
    if (prDetail.state === "draft") {
      parts.push(
        <span key="dr" style={{ color: "var(--ctp-overlay1)" }}>
          Draft
        </span>,
      );
    }

    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && (
              <span style={{ color: "var(--ctp-overlay1)" }}> · </span>
            )}
            {part}
          </span>
        ))}
      </>
    );
  }

  if (stage === WorkspaceStage.PullRequest && !prDetail) {
    return (
      <>
        <Age createdAt={ws.createdAt} />
        {ws.createdAt && <Sep />}
        <span style={{ color: "var(--ctp-overlay1)" }}>PR open</span>
      </>
    );
  }

  if (stage === WorkspaceStage.Merged && prDetail) {
    const parts: ReactNode[] = [];
    if (ws.createdAt) {
      parts.push(
        <span key="age" style={{ color: "var(--ctp-overlay1)" }}>
          {formatRelativeTime(ws.createdAt)}
        </span>,
      );
    }
    if (prDetail.mergedAt) {
      parts.push(
        <span key="m">merged {formatRelativeTime(prDetail.mergedAt)}</span>,
      );
    }
    const unanswered = prDetail.comments.noResponse + prDetail.comments.unresolved;
    if (unanswered > 0) {
      parts.push(
        <span key="u" style={{ color: "var(--ctp-peach)", fontWeight: 500 }}>
          {unanswered} unanswered comment{unanswered > 1 ? "s" : ""}
        </span>,
      );
    } else {
      parts.push(
        <span key="u" style={{ color: "var(--ctp-overlay1)" }}>
          0 unanswered comments
        </span>,
      );
    }
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && (
              <span style={{ color: "var(--ctp-overlay1)" }}> · </span>
            )}
            {part}
          </span>
        ))}
      </>
    );
  }

  // Merged without detail
  return (
    <>
      <Age createdAt={ws.createdAt} />
      {ws.createdAt && <Sep />}
      <span style={{ color: "var(--ctp-overlay1)" }}>Merged</span>
    </>
  );
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Stage badge config
const BADGE_CONFIG: Record<
  WorkspaceStage,
  { bg: string; color: string; label: string }
> = {
  [WorkspaceStage.New]: {
    bg: "rgba(78,158,255,0.15)",
    color: "var(--ctp-blue)",
    label: "New",
  },
  [WorkspaceStage.InDevelopment]: {
    bg: "rgba(246,168,120,0.15)",
    color: "var(--ctp-peach)",
    label: "Dev",
  },
  [WorkspaceStage.PullRequest]: {
    bg: "rgba(196,167,231,0.15)",
    color: "var(--ctp-mauve)",
    label: "",
  },
  [WorkspaceStage.Merged]: {
    bg: "rgba(94,200,94,0.15)",
    color: "var(--ctp-green)",
    label: "Merged",
  },
};

export function ProgressRow({
  workspace: ws,
  expanded,
  onToggleExpand,
  onArchived,
  onRefresh,
}: Props) {
  const badge = BADGE_CONFIG[ws.stage] ?? BADGE_CONFIG[WorkspaceStage.New];
  const isExpandable = ws.stage !== WorkspaceStage.New;
  const isMerged = ws.stage === WorkspaceStage.Merged;

  const handleBadgeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (ws.stage === WorkspaceStage.InDevelopment) {
        navigateToWorkspace(ws.workspacePath, ViewMode.Terminal);
      } else if (ws.stage === WorkspaceStage.PullRequest && ws.prURL) {
        const prLabel = ws.prDetail ? `PR #${ws.prDetail.prNumber}` : "Pull Request";
        openUrlInWorkspace(ws.workspacePath, ws.prURL, prLabel);
      }
    },
    [ws],
  );

  const handleArchive = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await api.archiveWorkspace(ws.workspaceId);
        onArchived();
      } catch (err) {
        console.error("[ProgressRow] Archive failed:", err);
      }
    },
    [ws.workspaceId, onArchived],
  );

  const handleAction = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (ws.stage === WorkspaceStage.New || ws.stage === WorkspaceStage.InDevelopment) {
        navigateToWorkspace(ws.workspacePath, ViewMode.Terminal);
      }
    },
    [ws],
  );

  // PR badge shows the PR number
  const badgeLabel =
    ws.stage === WorkspaceStage.PullRequest && ws.prDetail
      ? `#${ws.prDetail.prNumber}`
      : badge.label;

  const isReadyToMerge =
    ws.stage === WorkspaceStage.PullRequest &&
    ws.prDetail &&
    ws.prDetail.state === "open" &&
    ws.prDetail.checksFailed === 0 &&
    ws.prDetail.reviewSummary.changesRequested === 0 &&
    ws.prDetail.reviewSummary.approved > 0;

  return (
    <div className="rounded-md mb-px overflow-hidden">
      {/* Compact summary row */}
      <div
        onClick={isExpandable ? onToggleExpand : undefined}
        className="flex items-center py-1.5 px-3 rounded-md transition-colors duration-75"
        style={{
          cursor: isExpandable ? "pointer" : "default",
          backgroundColor: expanded
            ? "var(--ctp-mantle)"
            : "transparent",
          opacity: isMerged && !expanded ? 0.65 : 1,
          borderRadius: expanded ? "6px 6px 0 0" : undefined,
        }}
        onMouseEnter={(e) => {
          if (!expanded)
            e.currentTarget.style.backgroundColor = "var(--ctp-mantle)";
          if (isMerged) e.currentTarget.style.opacity = "0.85";
        }}
        onMouseLeave={(e) => {
          if (!expanded)
            e.currentTarget.style.backgroundColor = "transparent";
          if (isMerged && !expanded)
            e.currentTarget.style.opacity = "0.65";
        }}
      >
        {/* Expand chevron */}
        <span
          className="text-[9px] w-4 flex-shrink-0 text-center transition-transform duration-150"
          style={{
            color: "var(--ctp-overlay0)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            visibility: isExpandable ? "visible" : "hidden",
          }}
        >
          ▶
        </span>

        {/* Workspace name */}
        <span
          className="text-[13px] font-semibold w-80 flex-shrink-0 truncate"
          style={{ color: "var(--ctp-text)" }}
        >
          {ws.workspaceName}
        </span>

        {/* Repo name — click to open GitHub repo in workspace */}
        <button
          className="text-[11px] w-24 flex-shrink-0 truncate text-left transition-colors"
          style={{ color: "var(--ctp-overlay1)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--ctp-blue)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ctp-overlay1)"; }}
          onClick={async (e) => {
            e.stopPropagation();
            const result = await api.getRepoGitHubUrl(ws.workspacePath);
            if ("url" in result) {
              openUrlInWorkspace(ws.workspacePath, result.url, ws.repoName);
            }
          }}
        >
          {ws.repoName}
        </button>

        {/* Stage badge */}
        <button
          onClick={handleBadgeClick}
          className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 mr-2.5 transition-all duration-100"
          style={{
            backgroundColor: badge.bg,
            color: badge.color,
            cursor:
              ws.stage === WorkspaceStage.InDevelopment ||
              ws.stage === WorkspaceStage.PullRequest
                ? "pointer"
                : "default",
          }}
        >
          {badgeLabel}
        </button>

        {/* Summary text */}
        <span
          className="flex-1 text-[12px] truncate min-w-0"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          <SummaryText ws={ws} />
        </span>

        {/* Action button */}
        <span className="flex-shrink-0 ml-3">
          {ws.stage === WorkspaceStage.PullRequest && (
            <span
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded"
              style={
                isReadyToMerge
                  ? {
                      backgroundColor: "var(--ctp-green)",
                      color: "#1a1a1a",
                    }
                  : {
                      backgroundColor: "var(--ctp-surface0)",
                      color: "var(--ctp-overlay1)",
                    }
              }
            >
              {isReadyToMerge ? "Ready to Merge" : "Not Ready"}
            </span>
          )}
          {ws.stage === WorkspaceStage.InDevelopment && (
            <button
              onClick={handleAction}
              className="text-[11px] py-0.5"
              style={{ color: "var(--ctp-blue)" }}
            >
              Chat History →
            </button>
          )}
          {ws.stage === WorkspaceStage.New && (
            <button
              onClick={handleAction}
              className="text-[11px] py-0.5"
              style={{ color: "var(--ctp-blue)" }}
            >
              Open Session →
            </button>
          )}
          {ws.stage === WorkspaceStage.Merged && (
            <button
              onClick={handleArchive}
              className="text-[11px] font-medium px-2.5 py-0.5 rounded transition-colors"
              style={{
                border: "1px solid var(--ctp-surface1)",
                color: "var(--ctp-subtext0)",
              }}
            >
              Archive Workspace
            </button>
          )}
        </span>
      </div>

      {/* Expanded detail panel */}
      {expanded && isExpandable && (
        <ProgressRowDetail workspace={ws} onRefresh={onRefresh} />
      )}
    </div>
  );
}
