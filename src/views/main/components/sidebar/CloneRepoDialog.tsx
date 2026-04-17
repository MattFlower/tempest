import { useState, useRef, useEffect } from "react";
import { VCSType } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  onCloned: () => void;
  onDismiss: () => void;
}

function deriveRepoName(url: string): string {
  let cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const lastSep = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf(":"));
  if (lastSep >= 0) cleaned = cleaned.slice(lastSep + 1);
  return cleaned || "repo";
}

export function CloneRepoDialog({ onCloned, onDismiss }: Props) {
  useOverlay();

  const [vcsType, setVcsType] = useState<VCSType>(VCSType.Git);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [localPathManuallyEdited, setLocalPathManuallyEdited] = useState(false);
  const [colocate, setColocate] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  const handleUrlChange = (url: string) => {
    setRemoteUrl(url);
    setErrorMessage(null);
    if (!localPathManuallyEdited) {
      const name = deriveRepoName(url);
      setLocalPath(`~/tempest/repos/${name}`);
    }
  };

  const handleLocalPathChange = (path: string) => {
    setLocalPath(path);
    setLocalPathManuallyEdited(true);
    setErrorMessage(null);
  };

  const canClone = remoteUrl.trim() !== "" && localPath.trim() !== "" && !isCloning;

  const handleClone = async () => {
    if (!canClone) return;
    setIsCloning(true);
    setErrorMessage(null);

    const result = await api.cloneRepo({
      vcsType,
      url: remoteUrl.trim(),
      localPath: localPath.trim(),
      colocate: vcsType === VCSType.JJ ? colocate : undefined,
    });

    if (result.success) {
      setIsCloning(false);
      onCloned();
    } else {
      setErrorMessage(result.error ?? "Clone failed");
      setIsCloning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canClone) {
      e.preventDefault();
      handleClone();
    } else if (e.key === "Escape" && !isCloning) {
      e.preventDefault();
      onDismiss();
    }
  };

  const handleBackdropClick = () => {
    if (!isCloning) onDismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={handleBackdropClick}
    >
      <div
        className="flex flex-col gap-4 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 440,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <div className="text-center">
          <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
            Clone Remote Repository
          </h2>
        </div>

        {/* VCS Type Toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            Repository type
          </label>
          <div className="flex gap-1">
            {[VCSType.Git, VCSType.JJ].map((type) => (
              <button
                key={type}
                onClick={() => { setVcsType(type); setErrorMessage(null); }}
                disabled={isCloning}
                className="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  backgroundColor: vcsType === type ? "var(--ctp-mauve)" : "var(--ctp-surface0)",
                  color: vcsType === type ? "var(--ctp-base)" : "var(--ctp-overlay1)",
                  cursor: isCloning ? "not-allowed" : "pointer",
                }}
              >
                {type === VCSType.Git ? "Git" : "Jujutsu"}
              </button>
            ))}
          </div>
        </div>

        {/* Remote URL */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            Remote URL
          </label>
          <input
            ref={urlInputRef}
            type="text"
            value={remoteUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            disabled={isCloning}
            placeholder="https://github.com/owner/repo.git"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          />
        </div>

        {/* Local Path */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            Local path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => handleLocalPathChange(e.target.value)}
            disabled={isCloning}
            placeholder="~/tempest/repos/my-repo"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          />
        </div>

        {/* Colocate checkbox (JJ only) */}
        {vcsType === VCSType.JJ && (
          <label
            className="flex items-center gap-2 cursor-pointer"
            style={{ color: "var(--ctp-text)" }}
          >
            <input
              type="checkbox"
              checked={colocate}
              onChange={(e) => setColocate(e.target.checked)}
              disabled={isCloning}
              className="accent-[var(--ctp-mauve)]"
            />
            <span className="text-sm">Colocate with Git</span>
          </label>
        )}

        {/* Error message */}
        {errorMessage && (
          <p className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            disabled={isCloning}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)", opacity: isCloning ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={!canClone}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canClone ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
              color: canClone ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: canClone ? 1 : 0.5,
              cursor: canClone ? "pointer" : "not-allowed",
            }}
          >
            {isCloning ? "Cloning..." : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
