import { useState, useEffect, useRef } from "react";
import type { TempestWorkspace } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  workspace: TempestWorkspace;
  existingWorkspaces: TempestWorkspace[];
  onRenamed: (workspace: TempestWorkspace, newPath: string) => void;
  onDismiss: () => void;
}

const INVALID_NAME_CHARS = /[/\\:*?"<>|. ]/;

function isValidName(name: string, currentName: string, existingWorkspaces: TempestWorkspace[]): boolean {
  if (!name) return false;
  if (INVALID_NAME_CHARS.test(name)) return false;
  if (name === currentName) return false;
  if (existingWorkspaces.some((ws) => ws.name === name)) return false;
  return true;
}

export function RenameWorkspaceDialog({ workspace, existingWorkspaces, onRenamed, onDismiss }: Props) {
  useOverlay();
  const [name, setName] = useState(workspace.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameValid = isValidName(name, workspace.name, existingWorkspaces);
  const canRename = nameValid && !isRenaming;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleRename = async () => {
    if (!canRename) return;

    setIsRenaming(true);
    setErrorMessage(null);

    const result = await api.renameWorkspace(workspace.id, name);

    if (result.success && result.workspace && result.newPath) {
      onRenamed(result.workspace, result.newPath);
    } else {
      setErrorMessage(result.error ?? "Failed to rename workspace.");
      setIsRenaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canRename) {
      e.preventDefault();
      handleRename();
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
            Rename Workspace
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            Rename "{workspace.name}"
          </p>
        </div>

        {/* Name input */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            New name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrorMessage(null); }}
            placeholder="my-feature"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: `1px solid ${name && !nameValid && name !== workspace.name ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
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
            onClick={handleRename}
            disabled={!canRename}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canRename ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
              color: canRename ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: canRename ? 1 : 0.5,
              cursor: canRename ? "pointer" : "not-allowed",
            }}
          >
            {isRenaming ? "Renaming..." : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
