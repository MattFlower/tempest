import { useState, useEffect, useCallback } from "react";
import { PaneTabKind, ViewMode, WorkspaceStage } from "../../../../shared/ipc-types";
import type {
  WorkspaceProgressInfo,
  PRDetailInfo,
} from "../../../../shared/ipc-types";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { allPanes, createTab } from "../../models/pane-node";
import { addTab } from "../../state/actions";

interface Props {
  workspace: WorkspaceProgressInfo;
  onRefresh: () => void;
}

function navigateToWorkspace(wsPath: string, viewMode: ViewMode) {
  const store = useStore.getState();
  store.selectWorkspace(wsPath);
  store.setViewMode(wsPath, viewMode);
  store.setProgressViewActive(false);
}

/**
 * Jump to a workspace and open a MarkdownViewer tab for the given path.
 * Mirrors the openUrlInWorkspace helper in ProgressRow: the pane tree may
 * not be initialized yet, so we subscribe to the store and add the tab
 * once the target workspace's tree becomes available.
 */
function openPlanInWorkspace(wsPath: string, planPath: string) {
  const store = useStore.getState();
  store.selectWorkspace(wsPath);
  store.setViewMode(wsPath, ViewMode.Terminal);
  store.setProgressViewActive(false);

  const label = planPath.split("/").pop() ?? "Plan";

  const tryAddTab = () => {
    const state = useStore.getState();
    const tree = state.paneTrees[wsPath];
    if (!tree || state.selectedWorkspacePath !== wsPath) return false;

    const panes = allPanes(tree);
    const paneId = panes[0]?.id;
    if (!paneId) return false;

    state.setFocusedPaneId(paneId);
    const tab = createTab(PaneTabKind.MarkdownViewer, label, {
      markdownFilePath: planPath,
    });
    addTab(paneId, tab);
    return true;
  };

  if (tryAddTab()) return;

  const unsub = useStore.subscribe(() => {
    if (tryAddTab()) unsub();
  });
  setTimeout(() => unsub(), 5000);
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

function formatDateTime(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[10px] font-medium uppercase tracking-wide"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        {label}
      </span>
      <span
        className="text-[12px] font-medium"
        style={{ color: "var(--ctp-subtext1)" }}
      >
        {children}
      </span>
    </div>
  );
}

function PlanStat({ ws }: { ws: WorkspaceProgressInfo }) {
  if (!ws.planPath) return null;
  const name = ws.planPath.split("/").pop() ?? "Plan";
  return (
    <StatGroup label="Plan">
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openPlanInWorkspace(ws.workspacePath, ws.planPath!);
        }}
        className="text-[11px] no-underline truncate inline-block max-w-full"
        style={{ color: "var(--ctp-blue)" }}
        title={ws.planPath}
      >
        {name} →
      </a>
    </StatGroup>
  );
}

function DateStats({ ws }: { ws: WorkspaceProgressInfo }) {
  return (
    <>
      {ws.createdAt && (
        <StatGroup label="Created">
          {formatDateTime(ws.createdAt)}
        </StatGroup>
      )}
      {ws.lastOpenedAt && (
        <StatGroup label="Last Opened">
          {formatDateTime(ws.lastOpenedAt)}
        </StatGroup>
      )}
    </>
  );
}

function PRDetail({ ws }: { ws: WorkspaceProgressInfo }) {
  const [detail, setDetail] = useState<PRDetailInfo | null>(
    ws.prDetail ?? null,
  );
  const [loading, setLoading] = useState(!ws.prDetail);

  useEffect(() => {
    let cancelled = false;
    if (ws.prDetail) {
      setDetail(ws.prDetail);
      setLoading(false);
      return;
    }
    if (ws.branchName) {
      api
        .getPRDetail(ws.repoPath, ws.branchName)
        .then((d: PRDetailInfo | null) => {
          if (!cancelled) {
            setDetail(d);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [ws.prDetail, ws.repoPath, ws.branchName]);

  if (loading) {
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        Loading PR details...
      </span>
    );
  }

  if (!detail) {
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        Could not load PR details.
      </span>
    );
  }

  const checksUrl = ws.prURL ? `${ws.prURL}/checks` : undefined;
  const [owner, repo] = extractOwnerRepo(ws.prURL ?? "");

  return (
    <div
      className="grid gap-x-5 gap-y-2.5 w-full"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
    >
      <StatGroup label="Status">
        <span
          className="text-[10px] font-semibold uppercase tracking-tight px-1.5 py-0.5 rounded"
          style={
            detail.state === "open"
              ? {
                  backgroundColor: "rgba(94,200,94,0.12)",
                  color: "var(--ctp-green)",
                }
              : detail.state === "draft"
                ? {
                    backgroundColor: "rgba(110,110,110,0.15)",
                    color: "var(--ctp-overlay2)",
                  }
                : {
                    backgroundColor: "rgba(94,200,94,0.12)",
                    color: "var(--ctp-green)",
                  }
          }
        >
          {detail.state === "draft" ? "Draft" : detail.state === "merged" ? "Merged" : "Open"}
        </span>
      </StatGroup>

      <StatGroup label="Opened">
        {detail.openedAt ? formatRelativeTime(detail.openedAt) : "—"}
      </StatGroup>

      <StatGroup label="Branch">
        <span
          style={{
            fontFamily: '"SF Mono", Menlo, monospace',
            fontSize: 11,
          }}
        >
          {ws.branchName ?? "—"}
        </span>
      </StatGroup>

      <StatGroup label="Size">
        {ws.diffStats ? (
          <>
            <span style={{ color: "var(--ctp-green)" }}>
              +{ws.diffStats.additions}
            </span>{" "}
            <span style={{ color: "var(--ctp-red)" }}>
              &minus;{ws.diffStats.deletions}
            </span>
          </>
        ) : (
          "—"
        )}
      </StatGroup>

      <StatGroup label="Reviews">
        <span className="flex gap-1 flex-wrap">
          {detail.reviewSummary.approved > 0 && (
            <span
              className="text-[10px] font-medium px-1.5 py-px rounded"
              style={{
                backgroundColor: "rgba(94,200,94,0.12)",
                color: "var(--ctp-green)",
              }}
            >
              ✓ {detail.reviewSummary.approved} Approved
            </span>
          )}
          {detail.reviewSummary.changesRequested > 0 && (
            <span
              className="text-[10px] font-medium px-1.5 py-px rounded"
              style={{
                backgroundColor: "rgba(235,111,146,0.12)",
                color: "var(--ctp-red)",
              }}
            >
              ✗ {detail.reviewSummary.changesRequested} Changes Requested
            </span>
          )}
          {detail.reviewSummary.pending > 0 && (
            <span
              className="text-[10px] font-medium px-1.5 py-px rounded"
              style={{
                backgroundColor: "rgba(110,110,110,0.15)",
                color: "var(--ctp-overlay2)",
              }}
            >
              ○ {detail.reviewSummary.pending} Pending
            </span>
          )}
          {detail.reviewSummary.approved === 0 &&
            detail.reviewSummary.changesRequested === 0 &&
            detail.reviewSummary.pending === 0 && (
              <span style={{ color: "var(--ctp-overlay1)" }}>None</span>
            )}
        </span>
      </StatGroup>

      <StatGroup label="Comments">
        <span className="flex gap-2 text-[11px]">
          {detail.comments.noResponse > 0 && (
            <span style={{ color: "var(--ctp-subtext0)" }}>
              <span
                className="font-semibold"
                style={{ color: "var(--ctp-red)" }}
              >
                {detail.comments.noResponse}
              </span>{" "}
              no response
            </span>
          )}
          {detail.comments.unresolved > 0 && (
            <span style={{ color: "var(--ctp-subtext0)" }}>
              <span
                className="font-semibold"
                style={{ color: "var(--ctp-peach)" }}
              >
                {detail.comments.unresolved}
              </span>{" "}
              unresolved
            </span>
          )}
          {detail.comments.resolved > 0 && (
            <span style={{ color: "var(--ctp-subtext0)" }}>
              <span
                className="font-semibold"
                style={{ color: "var(--ctp-green)" }}
              >
                {detail.comments.resolved}
              </span>{" "}
              resolved
            </span>
          )}
          {detail.comments.noResponse === 0 &&
            detail.comments.unresolved === 0 &&
            detail.comments.resolved === 0 && (
              <span style={{ color: "var(--ctp-overlay1)" }}>None</span>
            )}
        </span>
      </StatGroup>

      <StatGroup label="Checks">
        <span className="flex gap-1">
          {detail.checksPassed > 0 && (
            <a
              href={checksUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-medium px-1.5 py-px rounded no-underline transition-all"
              style={{
                backgroundColor: "rgba(94,200,94,0.12)",
                color: "var(--ctp-green)",
              }}
            >
              ✓ {detail.checksPassed} passed
            </a>
          )}
          {detail.checksFailed > 0 && (
            <a
              href={checksUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-medium px-1.5 py-px rounded no-underline transition-all"
              style={{
                backgroundColor: "rgba(235,111,146,0.12)",
                color: "var(--ctp-red)",
              }}
            >
              ✗ {detail.checksFailed} failed
            </a>
          )}
          {detail.checksPassed === 0 && detail.checksFailed === 0 && (
            <span style={{ color: "var(--ctp-overlay1)" }}>None</span>
          )}
        </span>
      </StatGroup>

      <StatGroup label="Monitored">
        {ws.isMonitored ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigateToWorkspace(ws.workspacePath, ViewMode.Dashboard);
            }}
            className="text-[11px] no-underline"
            style={{ color: "var(--ctp-green)" }}
          >
            Yes — Dashboard →
          </a>
        ) : (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigateToWorkspace(ws.workspacePath, ViewMode.Dashboard);
            }}
            className="text-[11px] no-underline"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            No — Enable →
          </a>
        )}
      </StatGroup>

      <PlanStat ws={ws} />

      <DateStats ws={ws} />
    </div>
  );
}

function InDevDetail({ ws }: { ws: WorkspaceProgressInfo }) {
  return (
    <>
      <div
        className="grid gap-x-5 gap-y-2.5"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        }}
      >
        <StatGroup label="Branch">
          <span
            style={{
              fontFamily: '"SF Mono", Menlo, monospace',
              fontSize: 11,
            }}
          >
            {ws.branchName ?? "—"}
          </span>
        </StatGroup>
        <StatGroup label="Changes">
          {ws.diffStats ? (
            <>
              <span style={{ color: "var(--ctp-green)" }}>
                +{ws.diffStats.additions}
              </span>{" "}
              <span style={{ color: "var(--ctp-red)" }}>
                &minus;{ws.diffStats.deletions}
              </span>
            </>
          ) : (
            "—"
          )}
        </StatGroup>
        <PlanStat ws={ws} />
        <DateStats ws={ws} />
      </div>
      <div
        className="flex gap-3.5 mt-2.5 pt-2"
        style={{ borderTop: "1px solid var(--ctp-surface0)" }}
      >
        <a
          href="#"
          className="text-[12px] no-underline"
          style={{ color: "var(--ctp-blue)" }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateToWorkspace(ws.workspacePath, ViewMode.Terminal);
          }}
        >
          Chat History →
        </a>
        <a
          href="#"
          className="text-[12px] no-underline"
          style={{ color: "var(--ctp-blue)" }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateToWorkspace(ws.workspacePath, ViewMode.VCS);
          }}
        >
          VCS View →
        </a>
      </div>
    </>
  );
}

function MergedDetail({ ws }: { ws: WorkspaceProgressInfo }) {
  return (
    <div
      className="grid gap-x-5 gap-y-2.5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      }}
    >
      <StatGroup label="Merged">
        {ws.prDetail?.mergedAt
          ? formatRelativeTime(ws.prDetail.mergedAt)
          : "—"}
      </StatGroup>
      <StatGroup label="Unanswered Comments">
        {ws.prDetail ? (
          <span
            style={{
              color:
                ws.prDetail.comments.noResponse +
                  ws.prDetail.comments.unresolved >
                0
                  ? "var(--ctp-peach)"
                  : undefined,
            }}
          >
            {ws.prDetail.comments.noResponse +
              ws.prDetail.comments.unresolved}
          </span>
        ) : (
          "—"
        )}
      </StatGroup>
      <PlanStat ws={ws} />
      <DateStats ws={ws} />
    </div>
  );
}

function extractOwnerRepo(prUrl: string): [string, string] {
  try {
    const url = new URL(prUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return [parts[0] ?? "", parts[1] ?? ""];
  } catch {
    return ["", ""];
  }
}

export function ProgressRowDetail({ workspace: ws, onRefresh }: Props) {
  return (
    <div
      className="rounded-b-md pb-3 pl-10 pr-3"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div
        className="mb-2.5"
        style={{
          height: 1,
          backgroundColor: "var(--ctp-surface0)",
        }}
      />
      {ws.stage === WorkspaceStage.PullRequest && <PRDetail ws={ws} />}
      {ws.stage === WorkspaceStage.Merged && <MergedDetail ws={ws} />}
      {ws.stage === WorkspaceStage.InDevelopment && <InDevDetail ws={ws} />}
    </div>
  );
}
