import { useMemo, useCallback, useState, useEffect } from "react";
import { PaneTabKind, WorkspaceStatus, ActivityState, VCSType } from "../../../../shared/ipc-types";
import type { CustomScript, OpenPRState } from "../../../../shared/ipc-types";
import { createTab, createPane, createLeaf, createSplit, toNodeState } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { addTab, splitPane } from "../../state/actions";
import { api } from "../../state/rpc-client";
import { DropdownButton, type DropdownItem } from "./DropdownButton";
import { StatusBadge } from "./StatusBadge";
import { PRReviewDialog } from "../pr/PRReviewDialog";
import { OpenPRDialog } from "../pr/OpenPRDialog";
import { ScriptDialog } from "./ScriptDialog";
import { ScriptRunDialog } from "./ScriptRunDialog";

interface WorkspaceToolbarProps {
  workspacePath: string;
}

function addTabToFocusedPane(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  const { focusedPaneId } = useStore.getState();
  if (!focusedPaneId) return;
  const tab = createTab(kind, label, {
    ...(kind === PaneTabKind.Claude || kind === PaneTabKind.Shell
      ? { terminalId: crypto.randomUUID() }
      : {}),
    ...(kind === PaneTabKind.Browser ? { browserURL: "https://google.com" } : {}),
    ...overrides,
  });
  addTab(focusedPaneId, tab);
}

function splitWithTab(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  splitPane("right", true);
  setTimeout(() => addTabToFocusedPane(kind, label, overrides), 0);
}

// PR icon (git pull request / arrow.triangle.pull equivalent)
const PRIcon = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="3.5" r="2" />
    <circle cx="5" cy="12.5" r="2" />
    <circle cx="11" cy="12.5" r="2" />
    <path d="M5 5.5v5" />
    <path d="M11 5.5v5" />
    <path d="M11 5.5c0-1.5-1-2-2-2H7" />
    <path d="M8.5 2L7 3.5 8.5 5" />
  </svg>
);

export function WorkspaceToolbar({ workspacePath }: WorkspaceToolbarProps) {
  const workspacesByRepo = useStore((s) => s.workspacesByRepo);
  const repos = useStore((s) => s.repos);
  const activity = useStore((s) => s.workspaceActivity[workspacePath]);

  const [showPRReview, setShowPRReview] = useState(false);
  const [prReviewLoading, setPrReviewLoading] = useState(false);
  const [prReviewError, setPrReviewError] = useState<string | null>(null);
  const [showOpenPR, setShowOpenPR] = useState(false);
  const [showLinkPR, setShowLinkPR] = useState(false);
  const [linkPRUrl, setLinkPRUrl] = useState("");
  const [prState, setPrState] = useState<OpenPRState | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [vcsType, setVcsType] = useState<VCSType>(VCSType.Git);

  const [showScriptDialog, setShowScriptDialog] = useState(false);
  const [customScripts, setCustomScripts] = useState<CustomScript[]>([]);
  const [runningScript, setRunningScript] = useState<CustomScript | null>(null);
  const [packageScripts, setPackageScripts] = useState<Array<{ name: string; command: string }>>([]);
  const [disablePackageScripts, setDisablePackageScripts] = useState(false);

  // Find workspace object to get name and status
  const workspace = useMemo(() => {
    for (const workspaces of Object.values(workspacesByRepo)) {
      const found = workspaces.find((ws) => ws.path === workspacePath);
      if (found) return found;
    }
    return null;
  }, [workspacesByRepo, workspacePath]);

  // Find the repo for this workspace
  const repoId = useMemo(() => {
    if (!workspace) return null;
    const repo = repos.find((r) => r.path === workspace.repoPath);
    return repo?.id ?? null;
  }, [workspace, repos]);

  // Load custom scripts and settings for this repo
  useEffect(() => {
    if (!workspace?.repoPath) return;
    api.getRepoSettings(workspace.repoPath).then((settings: { customScripts?: CustomScript[]; disablePackageScripts?: boolean }) => {
      setCustomScripts(settings.customScripts ?? []);
      setDisablePackageScripts(settings.disablePackageScripts ?? false);
    });
  }, [workspace?.repoPath]);

  // Load package.json scripts for this workspace (also refreshed on dropdown open)
  const refreshPackageScripts = useCallback(() => {
    if (!workspacePath || disablePackageScripts) {
      setPackageScripts([]);
      return;
    }
    api.getPackageScripts(workspacePath).then((result: { scripts: Array<{ name: string; command: string }> }) => {
      setPackageScripts(result.scripts);
    });
  }, [workspacePath, disablePackageScripts]);

  useEffect(() => {
    refreshPackageScripts();
  }, [refreshPackageScripts]);

  // Load PR state and VCS type on mount / workspace change
  useEffect(() => {
    api.getOpenPRState(workspacePath).then((state: OpenPRState | null) => {
      setPrState(state);
    });
    if (workspace?.repoPath) {
      api.getVCSType(workspace.repoPath).then((type: VCSType) => {
        setVcsType(type);
      });
    }
  }, [workspacePath, workspace?.repoPath]);

  const handleRunScript = useCallback(
    async (cs: CustomScript) => {
      if (!workspace) return;
      const hasParams = (cs.parameters?.length ?? 0) > 0;

      // If the script has parameters or showOutput, open the run dialog
      if (hasParams || cs.showOutput) {
        setRunningScript(cs);
        return;
      }

      // Otherwise fire-and-forget
      await api.runCustomScript({
        repoPath: workspace.repoPath,
        workspacePath: workspacePath,
        workspaceName: workspace.name,
        script: cs.script || undefined,
        scriptPath: cs.scriptPath || undefined,
      });
    },
    [workspace, workspacePath],
  );

  const handleRunPackageScript = useCallback(
    (ps: { name: string; command: string }) => {
      if (!workspace) return;
      setRunningScript({
        id: `pkg-${ps.name}`,
        name: ps.name,
        script: ps.command,
        showOutput: true,
      });
    },
    [workspace],
  );

  // Derive effective status (activity overrides workspace.status)
  let effectiveStatus = workspace?.status ?? WorkspaceStatus.Idle;
  if (activity === ActivityState.Working) effectiveStatus = WorkspaceStatus.Working;
  else if (activity === ActivityState.NeedsInput) effectiveStatus = WorkspaceStatus.NeedsInput;
  else if (activity === ActivityState.Idle) effectiveStatus = WorkspaceStatus.Idle;

  const workspaceName = workspace?.name ?? workspacePath.split("/").pop() ?? "Workspace";

  const handleViewPRInBrowser = useCallback(async () => {
    const paneId = useStore.getState().focusedPaneId;
    setPrError(null);

    // Fast path: use cached PR URL
    if (prState?.prURL) {
      if (!paneId) return;
      const tab = createTab(PaneTabKind.Browser, "PR", { browserURL: prState.prURL });
      addTab(paneId, tab);
      return;
    }

    // Slow path: discover via gh CLI
    try {
      const result = await api.lookupPRUrl(workspacePath);
      if ("error" in result) {
        setPrError(result.error);
        return;
      }
      if (!paneId) return;
      const tab = createTab(PaneTabKind.Browser, "PR", { browserURL: result.url });
      addTab(paneId, tab);

      // Cache for future use
      const newState: OpenPRState = { prURL: result.url };
      setPrState(newState);
      api.setOpenPRState(workspacePath, newState);
    } catch (err) {
      setPrError(err instanceof Error ? err.message : String(err));
    }
  }, [workspacePath, prState]);

  const handleOpenPR = useCallback(async () => {
    setPrError(null);
    if (prState) {
      // PR already exists — just push updates
      try {
        const result = await api.updatePR(workspacePath);
        if (!result.success) {
          setPrError(result.error ?? "Push failed.");
        }
      } catch (err) {
        setPrError(err instanceof Error ? err.message : String(err));
      }
    } else {
      // No PR yet — show dialog
      setShowOpenPR(true);
    }
  }, [workspacePath, prState]);

  const handlePRCreated = useCallback((prURL: string, bookmarkName?: string) => {
    const newState: OpenPRState = { prURL, bookmarkName };
    setPrState(newState);
    setShowOpenPR(false);

    // Open the PR in a browser tab
    const paneId = useStore.getState().focusedPaneId;
    if (paneId) {
      const tab = createTab(PaneTabKind.Browser, "PR", { browserURL: prURL });
      addTab(paneId, tab);
    }
  }, []);

  const handleLinkPR = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;

    // Store the linked PR state
    const newState: OpenPRState = { prURL: trimmed };
    setPrState(newState);
    api.setOpenPRState(workspacePath, newState);

    // Open in browser tab
    const paneId = useStore.getState().focusedPaneId;
    if (paneId) {
      const tab = createTab(PaneTabKind.Browser, "PR", { browserURL: trimmed });
      addTab(paneId, tab);
    }
    setShowLinkPR(false);
    setLinkPRUrl("");
  }, [workspacePath]);

  const handleStartPRReview = useCallback(async (prNumber: number) => {
    if (!repoId) {
      setPrReviewError("Could not determine repository for this workspace.");
      return;
    }

    setPrReviewLoading(true);
    setPrReviewError(null);

    try {
      const result = await api.startPRReview(repoId, prNumber);

      if (!result.success || !result.workspace) {
        setPrReviewError(result.error ?? "Failed to create workspace.");
        setPrReviewLoading(false);
        return;
      }

      // Switch to the new workspace
      const store = useStore.getState();
      store.selectWorkspace(result.workspace.path);

      // Set up 3-pane layout: Shell + Browser (PR URL) + Claude
      const shellTab = createTab(PaneTabKind.Shell, "Shell", { terminalId: crypto.randomUUID() });
      const shellPane = createPane(shellTab);

      const browserTab = createTab(PaneTabKind.Browser, "PR", {
        browserURL: result.prUrl ?? `https://github.com`,
      });
      const browserPane = createPane(browserTab);

      const claudeTab = createTab(PaneTabKind.Claude, "Claude", { terminalId: crypto.randomUUID() });
      const claudePane = createPane(claudeTab);

      const tree = createSplit(
        [createLeaf(shellPane), createLeaf(browserPane), createLeaf(claudePane)],
        [1, 1, 1],
      );

      store.setPaneTree(result.workspace.path, tree);
      store.setFocusedPaneId(shellPane.id);
      api.notifyPaneTreeChanged(result.workspace.path, toNodeState(tree));

      setShowPRReview(false);
      setPrReviewLoading(false);
    } catch (err: any) {
      setPrReviewError(err.message ?? String(err));
      setPrReviewLoading(false);
    }
  }, [repoId]);

  const newItems: DropdownItem[] = [
    { label: "Terminal", action: () => addTabToFocusedPane(PaneTabKind.Shell, "Shell") },
    { label: "Claude", action: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude") },
    { label: "Claude (Continue)", action: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude", { resume: true }) },
    { label: "Browser", action: () => addTabToFocusedPane(PaneTabKind.Browser, "Browser") },
    { label: "Chat History", action: () => addTabToFocusedPane(PaneTabKind.HistoryViewer, "History") },
  ];

  const splitItems: DropdownItem[] = [
    { label: "Terminal", action: () => splitWithTab(PaneTabKind.Shell, "Shell") },
    { label: "Claude", action: () => splitWithTab(PaneTabKind.Claude, "Claude") },
    { label: "Claude (Continue)", action: () => splitWithTab(PaneTabKind.Claude, "Claude", { resume: true }) },
    { label: "Browser", action: () => splitWithTab(PaneTabKind.Browser, "Browser") },
    { label: "Chat History", action: () => splitWithTab(PaneTabKind.HistoryViewer, "History") },
  ];

  const prItems: DropdownItem[] = [
    { label: prState ? "Update PR" : "Open PR", action: handleOpenPR },
    { label: "Link PR", action: () => { setShowLinkPR(true); setLinkPRUrl(""); } },
    { label: "View PR in Browser", action: handleViewPRInBrowser },
    {
      label: "PR Review",
      action: () => {
        setPrReviewError(null);
        setShowPRReview(true);
      },
    },
  ];

  const scriptsItems: DropdownItem[] = [
    ...customScripts.map((cs) => ({
      label: cs.name,
      action: () => handleRunScript(cs),
    })),
    ...(customScripts.length > 0 && packageScripts.length > 0
      ? [{ separator: true } as const]
      : []),
    ...packageScripts.map((ps) => ({
      label: ps.command,
      action: () => handleRunPackageScript(ps),
    })),
    ...(customScripts.length > 0 || packageScripts.length > 0
      ? [{ separator: true } as const]
      : []),
    { label: "Manage Scripts", action: () => setShowScriptDialog(true) },
  ];

  return (
    <>
      <div
        className="flex items-center px-4 py-1.5 flex-shrink-0 border-b border-[var(--ctp-surface0)]"
        style={{ backgroundColor: "var(--ctp-mantle)" }}
      >
        <span className="text-sm font-semibold text-[var(--ctp-text)] mr-2">
          {workspaceName}
        </span>
        <StatusBadge status={effectiveStatus} />

        <span className="flex-1" />

        {prError && (
          <span
            className="text-xs mr-2 px-2 py-0.5 rounded cursor-pointer"
            style={{ backgroundColor: "rgba(243, 139, 168, 0.15)", color: "var(--ctp-red)" }}
            onClick={() => setPrError(null)}
            title="Click to dismiss"
          >
            {prError}
          </span>
        )}

        <div className="flex items-center gap-1">
          <DropdownButton label="New" items={newItems} onDefaultAction={() => addTabToFocusedPane(PaneTabKind.Shell, "Shell")} />
          <DropdownButton label="Split" items={splitItems} onDefaultAction={() => splitWithTab(PaneTabKind.Shell, "Shell")} />
          <DropdownButton label="PR" icon={PRIcon} items={prItems} />
          <DropdownButton
            label=""
            icon={<svg className="w-[1.375rem] h-[1.375rem]" viewBox="0 0 16 16" fill="var(--ctp-green)"><path d="M4 2l10 6-10 6V2z" /></svg>}
            items={scriptsItems}
            onOpen={refreshPackageScripts}
          />
        </div>
      </div>

      {showPRReview && repoId && (
        <PRReviewDialog
          repoId={repoId}
          onStartReview={handleStartPRReview}
          onDismiss={() => {
            setShowPRReview(false);
            setPrReviewError(null);
          }}
          isLoading={prReviewLoading}
          errorMessage={prReviewError}
        />
      )}

      {showOpenPR && workspace && (
        <OpenPRDialog
          workspacePath={workspacePath}
          workspaceName={workspace.name}
          vcsType={vcsType}
          onCreated={handlePRCreated}
          onDismiss={() => setShowOpenPR(false)}
        />
      )}

      {showScriptDialog && workspace && (
        <ScriptDialog
          repoPath={workspace.repoPath}
          workspacePath={workspacePath}
          workspaceName={workspace.name}
          scripts={customScripts}
          disablePackageScripts={disablePackageScripts}
          onChanged={setCustomScripts}
          onDisablePackageScriptsChanged={(disabled) => {
            setDisablePackageScripts(disabled);
          }}
          onDismiss={() => setShowScriptDialog(false)}
        />
      )}

      {runningScript && workspace && (
        <ScriptRunDialog
          script={runningScript}
          repoPath={workspace.repoPath}
          workspacePath={workspacePath}
          workspaceName={workspace.name}
          onDismiss={() => setRunningScript(null)}
        />
      )}

      {showLinkPR && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15%]" onClick={() => setShowLinkPR(false)}>
          <div
            className="w-[450px] flex flex-col rounded-xl border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-2xl overflow-hidden p-4 gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-semibold text-[var(--ctp-text)]">Link PR</span>
            <input
              type="text"
              value={linkPRUrl}
              onChange={(e) => setLinkPRUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLinkPR(linkPRUrl); if (e.key === "Escape") setShowLinkPR(false); }}
              placeholder="https://github.com/owner/repo/pull/123"
              className="px-3 py-2 text-sm rounded outline-none"
              style={{
                backgroundColor: "var(--ctp-mantle)",
                color: "var(--ctp-text)",
                border: "1px solid var(--ctp-surface1)",
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowLinkPR(false)}
                className="px-3 py-1.5 text-xs rounded"
                style={{ backgroundColor: "var(--ctp-surface1)", color: "var(--ctp-text)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleLinkPR(linkPRUrl)}
                disabled={!linkPRUrl.trim()}
                className="px-3 py-1.5 text-xs rounded"
                style={{
                  backgroundColor: "var(--ctp-blue)",
                  color: "var(--ctp-base)",
                  opacity: !linkPRUrl.trim() ? 0.5 : 1,
                }}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
