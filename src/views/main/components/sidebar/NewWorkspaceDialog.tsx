import { useState, useEffect, useRef } from "react";
import type { SourceRepo, TempestWorkspace } from "../../../../shared/ipc-types";
import { VCSType } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { fuzzyMatch } from "../palette/fuzzy-match";

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

/** Convert a branch name like "feature/my-thing" to a workspace name like "feature-my-thing" */
function branchToWorkspaceName(branch: string): string {
  return branch.replace(/\//g, "-");
}

const MAX_DROPDOWN_ITEMS = 50;

export function NewWorkspaceDialog({ repo, existingWorkspaces, onCreated, onDismiss }: Props) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchManuallyEdited, setBranchManuallyEdited] = useState(false);
  const [workspaceNameManuallyEdited, setWorkspaceNameManuallyEdited] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [useExistingBranch, setUseExistingBranch] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  // Branch autocomplete state
  const [branches, setBranches] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isGit = repo.vcsType === VCSType.Git;
  const nameValid = isValidName(workspaceName, existingWorkspaces);
  const branchValid = !isGit || (useExistingBranch ? branchName.length > 0 : isValidBranch(branchName));
  const canCreate = nameValid && branchValid && !isCreating;

  // Auto-focus the name input
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Fetch branches on mount
  useEffect(() => {
    if (isGit) {
      api.getBranches(repo.id).then((result: string[]) => {
        setBranches(result);
      });
    }
  }, [repo.id, isGit]);

  // Compute filtered branches for dropdown
  const filteredBranches = branchName
    ? branches
        .map((b) => ({ name: b, match: fuzzyMatch(branchName, b) }))
        .filter((r) => r.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
        .slice(0, MAX_DROPDOWN_ITEMS)
    : branches.slice(0, MAX_DROPDOWN_ITEMS).map((b) => ({ name: b, match: { indices: [] as number[], score: 0 } }));

  // Check if typed branch exactly matches an existing branch
  const exactMatch = branches.includes(branchName);

  // Update useExistingBranch when branch name changes
  useEffect(() => {
    setUseExistingBranch(exactMatch);
  }, [exactMatch]);

  // Reset dropdown index when filtered results change
  useEffect(() => {
    setDropdownIndex(0);
  }, [branchName]);

  // Scroll selected dropdown item into view
  useEffect(() => {
    const list = dropdownRef.current;
    if (!list) return;
    const item = list.children[dropdownIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [dropdownIndex]);

  const handleWorkspaceNameChange = (value: string) => {
    setWorkspaceName(value);
    setWorkspaceNameManuallyEdited(true);
    setErrorMessage(null);
    if (!branchManuallyEdited) {
      setBranchName(value);
    }
  };

  const selectBranch = (branch: string) => {
    setBranchName(branch);
    setBranchManuallyEdited(true);
    setUseExistingBranch(true);
    setShowDropdown(false);
    setErrorMessage(null);
    // Auto-fill workspace name from branch unless manually edited
    if (!workspaceNameManuallyEdited) {
      setWorkspaceName(branchToWorkspaceName(branch));
    }
  };

  const handleBranchNameChange = (value: string) => {
    setBranchName(value);
    setBranchManuallyEdited(true);
    setErrorMessage(null);
    setShowDropdown(true);
    // Auto-fill workspace name if not manually edited
    if (!workspaceNameManuallyEdited) {
      setWorkspaceName(branchToWorkspaceName(value));
    }
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
      useExistingBranch: isGit ? useExistingBranch : undefined,
    });

    if (result.success && result.workspace) {
      onCreated(result.workspace);
    } else {
      setErrorMessage(result.error ?? "Failed to create workspace.");
      setIsCreating(false);
    }
  };

  const handleBranchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filteredBranches.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        setDropdownIndex((i) => Math.min(filteredBranches.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        setDropdownIndex((i) => Math.max(0, i - 1));
        break;
      case "Enter":
        if (showDropdown && filteredBranches[dropdownIndex]) {
          e.preventDefault();
          e.stopPropagation();
          selectBranch(filteredBranches[dropdownIndex].name);
        }
        break;
      case "Escape":
        if (showDropdown) {
          e.preventDefault();
          e.stopPropagation();
          setShowDropdown(false);
        }
        break;
      case "Tab":
        if (showDropdown && filteredBranches[dropdownIndex]) {
          e.preventDefault();
          e.stopPropagation();
          selectBranch(filteredBranches[dropdownIndex].name);
        }
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canCreate && !showDropdown) {
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
          width: 400,
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

        {/* Branch name with autocomplete (git only) — shown first so user picks branch, then workspace name auto-fills */}
        {isGit && (
          <div className="flex flex-col gap-1 relative">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
                Branch
              </label>
              {branchName && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: useExistingBranch ? "var(--ctp-teal)" : "var(--ctp-mauve)",
                    color: "var(--ctp-base)",
                  }}
                >
                  {useExistingBranch ? "existing" : "new"}
                </span>
              )}
            </div>
            <input
              ref={branchInputRef}
              type="text"
              value={branchName}
              onChange={(e) => handleBranchNameChange(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => {
                // Delay to allow click on dropdown item
                setTimeout(() => setShowDropdown(false), 150);
              }}
              onKeyDown={handleBranchKeyDown}
              placeholder="Search existing or type new branch..."
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
            {/* Autocomplete dropdown */}
            {showDropdown && filteredBranches.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 z-10 rounded-lg border overflow-y-auto py-1"
                style={{
                  top: "100%",
                  marginTop: 4,
                  maxHeight: 200,
                  backgroundColor: "var(--ctp-surface0)",
                  borderColor: "var(--ctp-surface1)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {filteredBranches.map((item, index) => (
                  <div
                    key={item.name}
                    role="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectBranch(item.name);
                    }}
                    onMouseEnter={() => setDropdownIndex(index)}
                    className="px-3 py-1.5 cursor-pointer text-[13px]"
                    style={{
                      backgroundColor: index === dropdownIndex ? "var(--ctp-surface1)" : "transparent",
                    }}
                  >
                    {branchName ? (
                      // Highlight matched characters
                      Array.from(item.name).map((char, i) => (
                        <span
                          key={i}
                          style={{
                            color: item.match?.indices.includes(i) ? "var(--ctp-text)" : "var(--ctp-subtext0)",
                            fontWeight: item.match?.indices.includes(i) ? 600 : 400,
                          }}
                        >
                          {char}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: "var(--ctp-subtext0)" }}>{item.name}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
