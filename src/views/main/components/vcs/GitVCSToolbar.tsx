// ============================================================
// GitVCSToolbar — Pull/Push/Merge/Rebase action buttons.
// Shown above the scope selector in the Git VCS view.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitBranchInfo } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";

interface GitVCSToolbarProps {
  workspacePath: string;
  onAction: (
    result: { success: boolean; error?: string; output?: string },
    label: string,
  ) => void;
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return { open, setOpen, ref };
}

function ToolbarButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors"
      style={{
        backgroundColor: "var(--ctp-surface0)",
        color: disabled ? "var(--ctp-overlay0)" : "var(--ctp-text)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
      <span style={{ color: "var(--ctp-overlay1)" }}>&#x25BE;</span>
    </button>
  );
}

function DropdownPanel({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className="absolute top-full mt-1 z-50 rounded-lg shadow-lg overflow-hidden"
      style={{
        backgroundColor: "var(--ctp-surface0)",
        border: "1px solid var(--ctp-surface1)",
        minWidth: 220,
        [align === "left" ? "left" : "right"]: 0,
      }}
    >
      {children}
    </div>
  );
}

function BranchSearchList({
  branches,
  search,
  onSearchChange,
  onSelect,
  emptyLabel,
}: {
  branches: GitBranchInfo[];
  search: string;
  onSearchChange: (s: string) => void;
  onSelect: (b: GitBranchInfo) => void;
  emptyLabel: string;
}) {
  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <div className="px-2 pt-2 pb-1">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search branches..."
          className="w-full text-xs px-2 py-1 rounded outline-none"
          style={{
            backgroundColor: "var(--ctp-base)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface1)",
          }}
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <div
            className="px-3 py-2 text-[11px]"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {emptyLabel}
          </div>
        ) : (
          filtered.map((b) => (
            <button
              key={b.name}
              className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-opacity flex items-center justify-between gap-2"
              style={{ color: "var(--ctp-text)" }}
              onClick={() => onSelect(b)}
            >
              <span className="truncate">{b.name}</span>
              {b.isRemote && (
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ctp-overlay0)" }}
                >
                  remote
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </>
  );
}

export function GitVCSToolbar({ workspacePath, onAction }: GitVCSToolbarProps) {
  const pullDropdown = useDropdown();
  const pushDropdown = useDropdown();
  const mergeDropdown = useDropdown();
  const rebaseDropdown = useDropdown();

  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pushSearch, setPushSearch] = useState("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [rebaseSearch, setRebaseSearch] = useState("");

  // Remote-selection modal for Push when multiple remotes exist
  const [remotePicker, setRemotePicker] = useState<{ branch: string } | null>(
    null,
  );

  const refreshBranches = useCallback(async () => {
    try {
      const result = await api.gitListBranchesAndRemotes(workspacePath);
      setBranches(result.branches);
      setRemotes(result.remotes);
      setCurrentBranch(result.current);
    } catch (err: any) {
      onAction(
        { success: false, error: err?.message ?? "Failed to load branches" },
        "Load branches",
      );
    }
  }, [workspacePath, onAction]);

  const runOp = useCallback(
    async (label: string, fn: () => Promise<{ success: boolean; error?: string; output?: string }>) => {
      setBusy(true);
      try {
        const result = await fn();
        onAction(result, label);
      } catch (err: any) {
        onAction(
          { success: false, error: err?.message ?? `${label} failed` },
          label,
        );
      }
      setBusy(false);
    },
    [onAction],
  );

  const handlePull = useCallback(() => {
    pullDropdown.setOpen(false);
    runOp("Pull", () => api.gitPull(workspacePath));
  }, [pullDropdown, runOp, workspacePath]);

  const handleFetch = useCallback(() => {
    pullDropdown.setOpen(false);
    runOp("Fetch", () => api.gitFetchAll(workspacePath));
  }, [pullDropdown, runOp, workspacePath]);

  const handlePushSelectBranch = useCallback(
    async (b: GitBranchInfo) => {
      pushDropdown.setOpen(false);
      const branchName = b.isRemote ? b.name.split("/").slice(1).join("/") : b.name;
      if (remotes.length === 0) {
        onAction({ success: false, error: "No remotes configured" }, "Push");
        return;
      }
      if (remotes.length === 1) {
        runOp("Push", () =>
          api.gitPushBranch(workspacePath, branchName, remotes[0]!),
        );
        return;
      }
      setRemotePicker({ branch: branchName });
    },
    [pushDropdown, remotes, runOp, workspacePath, onAction],
  );

  const handlePushToRemote = useCallback(
    (remote: string) => {
      if (!remotePicker) return;
      const branchName = remotePicker.branch;
      setRemotePicker(null);
      runOp("Push", () => api.gitPushBranch(workspacePath, branchName, remote));
    },
    [remotePicker, runOp, workspacePath],
  );

  const handleMerge = useCallback(
    (b: GitBranchInfo) => {
      mergeDropdown.setOpen(false);
      runOp("Merge", () => api.gitMergeBranch(workspacePath, b.name));
    },
    [mergeDropdown, runOp, workspacePath],
  );

  const handleRebase = useCallback(
    (b: GitBranchInfo) => {
      rebaseDropdown.setOpen(false);
      runOp("Rebase", () => api.gitRebaseOnto(workspacePath, b.name));
    },
    [rebaseDropdown, runOp, workspacePath],
  );

  const localBranches = branches.filter((b) => !b.isRemote);
  const otherBranches = branches.filter((b) => b.name !== currentBranch);

  const openWithRefresh = (dropdown: ReturnType<typeof useDropdown>, resetSearch?: () => void) => {
    if (!dropdown.open) {
      refreshBranches();
      resetSearch?.();
    }
    dropdown.setOpen(!dropdown.open);
  };

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        {/* Pull */}
        <div className="relative" ref={pullDropdown.ref}>
          <ToolbarButton
            label="Pull"
            disabled={busy}
            onClick={() => pullDropdown.setOpen(!pullDropdown.open)}
          />
          {pullDropdown.open && (
            <DropdownPanel>
              <button
                className="w-full text-left px-3 py-2 text-xs hover:opacity-80 transition-opacity"
                style={{ color: "var(--ctp-text)" }}
                onClick={handlePull}
              >
                Pull
              </button>
              <div style={{ borderTop: "1px solid var(--ctp-surface1)" }} />
              <button
                className="w-full text-left px-3 py-2 text-xs hover:opacity-80 transition-opacity"
                style={{ color: "var(--ctp-text)" }}
                onClick={handleFetch}
              >
                Fetch (all remotes)
              </button>
            </DropdownPanel>
          )}
        </div>

        {/* Push */}
        <div className="relative" ref={pushDropdown.ref}>
          <ToolbarButton
            label="Push"
            disabled={busy}
            onClick={() => openWithRefresh(pushDropdown, () => setPushSearch(""))}
          />
          {pushDropdown.open && (
            <DropdownPanel>
              <BranchSearchList
                branches={localBranches}
                search={pushSearch}
                onSearchChange={setPushSearch}
                onSelect={handlePushSelectBranch}
                emptyLabel="No local branches"
              />
            </DropdownPanel>
          )}
        </div>

        {/* Merge */}
        <div className="relative" ref={mergeDropdown.ref}>
          <ToolbarButton
            label="Merge"
            disabled={busy}
            onClick={() => openWithRefresh(mergeDropdown, () => setMergeSearch(""))}
          />
          {mergeDropdown.open && (
            <DropdownPanel>
              <BranchSearchList
                branches={otherBranches}
                search={mergeSearch}
                onSearchChange={setMergeSearch}
                onSelect={handleMerge}
                emptyLabel="No branches to merge"
              />
            </DropdownPanel>
          )}
        </div>

        {/* Rebase */}
        <div className="relative" ref={rebaseDropdown.ref}>
          <ToolbarButton
            label="Rebase"
            disabled={busy}
            onClick={() => openWithRefresh(rebaseDropdown, () => setRebaseSearch(""))}
          />
          {rebaseDropdown.open && (
            <DropdownPanel>
              <BranchSearchList
                branches={otherBranches}
                search={rebaseSearch}
                onSearchChange={setRebaseSearch}
                onSelect={handleRebase}
                emptyLabel="No branches to rebase onto"
              />
            </DropdownPanel>
          )}
        </div>
      </div>

      {/* Remote picker modal for Push */}
      {remotePicker && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setRemotePicker(null)}
          />
          <div
            className="relative rounded-lg shadow-xl p-4 max-w-sm w-80"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
            }}
          >
            <p className="text-sm mb-1" style={{ color: "var(--ctp-text)" }}>
              Choose remote
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--ctp-subtext0)" }}>
              Push <strong>{remotePicker.branch}</strong> to which remote?
            </p>
            <div className="flex flex-col gap-1 mb-3 max-h-48 overflow-y-auto">
              {remotes.map((r) => (
                <button
                  key={r}
                  className="w-full text-left px-3 py-1.5 text-xs rounded hover:opacity-80 transition-opacity"
                  style={{
                    background: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                  onClick={() => handlePushToRemote(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                className="px-3 py-1 text-xs rounded"
                style={{
                  background: "var(--ctp-surface1)",
                  color: "var(--ctp-text)",
                }}
                onClick={() => setRemotePicker(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
