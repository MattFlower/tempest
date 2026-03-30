import { useState, useEffect, useRef } from "react";
import type { SourceRepo, TempestWorkspace } from "../../../../shared/ipc-types";
import { VCSType } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";

interface Props {
  repo: SourceRepo;
  existingWorkspaces: TempestWorkspace[];
  onCreated: (workspace: TempestWorkspace) => void;
  onDismiss: () => void;
}

const INVALID_NAME_CHARS = /[/\\:*?"<>|. ]/;
const INVALID_BRANCH_CHARS = /[:\\~ \x00-\x1f\x7f]/;

function isValidName(name: string, existingWorkspaces: TempestWorkspace[]): boolean {
  if (!name) return false;
  if (INVALID_NAME_CHARS.test(name)) return false;
  if (existingWorkspaces.some((ws) => ws.name === name)) return false;
  return true;
}

function isValidBranch(branch: string): boolean {
  if (!branch) return false;
  if (branch.includes("..")) return false;
  if (branch.startsWith(".")) return false;
  if (INVALID_BRANCH_CHARS.test(branch)) return false;
  return true;
}

export function NewWorkspaceDialog({ repo, existingWorkspaces, onCreated, onDismiss }: Props) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchManuallyEdited, setBranchManuallyEdited] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isGit = repo.vcsType === VCSType.Git;
  const nameValid = isValidName(workspaceName, existingWorkspaces);
  const branchValid = !isGit || isValidBranch(branchName);
  const canCreate = nameValid && branchValid && !isCreating;

  // Auto-focus the name input
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleWorkspaceNameChange = (value: string) => {
    setWorkspaceName(value);
    setErrorMessage(null);
    if (!branchManuallyEdited) {
      setBranchName(value);
    }
  };

  const handleBranchNameChange = (value: string) => {
    setBranchName(value);
    setBranchManuallyEdited(true);
    setErrorMessage(null);
  };

  const handleCreate = async () => {
    if (isCreating) return;

    if (!nameValid) {
      setErrorMessage(workspaceName ? "Invalid name or name already in use." : null);
      return;
    }
    if (isGit && !branchValid) {
      setErrorMessage("Invalid branch name.");
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);

    const result = await api.createWorkspace({
      repoId: repo.id,
      name: workspaceName,
      branch: isGit ? branchName : undefined,
    });

    if (result.success && result.workspace) {
      onCreated(result.workspace);
    } else {
      setErrorMessage(result.error ?? "Failed to create workspace.");
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canCreate) {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={onDismiss}>
      <div
        className="flex flex-col gap-4 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 350,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <div className="text-center">
          <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
            New Workspace
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            Create a new workspace in {repo.name}
          </p>
        </div>

        {/* Workspace name */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            Workspace name
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={workspaceName}
            onChange={(e) => handleWorkspaceNameChange(e.target.value)}
            placeholder="my-feature"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: `1px solid ${workspaceName && !nameValid ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
            }}
          />
        </div>

        {/* Branch name (git only) */}
        {isGit && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
              Branch name
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => handleBranchNameChange(e.target.value)}
              placeholder="feature/my-feature"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="px-3 py-1.5 rounded text-sm outline-none"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                border: `1px solid ${branchName && !branchValid ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
              }}
            />
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <p className="text-[11px]" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canCreate ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
              color: canCreate ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: canCreate ? 1 : 0.5,
              cursor: canCreate ? "pointer" : "not-allowed",
            }}
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
