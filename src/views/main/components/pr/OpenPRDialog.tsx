import { useState, useEffect, useRef } from "react";
import { VCSType } from "../../../../shared/ipc-types";
import { useOverlay } from "../../state/useOverlay";
import { api } from "../../state/rpc-client";

interface Props {
  workspacePath: string;
  workspaceName: string;
  vcsType: VCSType;
  onCreated: (prURL: string, bookmarkName?: string) => void;
  onDismiss: () => void;
}

export function OpenPRDialog({ workspacePath, workspaceName, vcsType, onCreated, onDismiss }: Props) {
  useOverlay();

  const [bookmarkName, setBookmarkName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const isJJ = vcsType === VCSType.JJ;
  const canSubmit = !isLoading && !isLoadingDefaults && title.trim() !== "" && (!isJJ || bookmarkName.trim() !== "");

  // Load default title/body/bookmark on mount
  useEffect(() => {
    setIsLoadingDefaults(true);
    api.getDefaultPRTitleBody(workspacePath).then((result: any) => {
      if ("error" in result) {
        // Non-fatal — user can still type manually
      } else {
        setTitle(result.title);
        setBody(result.body);
        if (result.bookmarkName) setBookmarkName(result.bookmarkName);
      }
      setIsLoadingDefaults(false);
      setTimeout(() => titleRef.current?.focus(), 0);
    });
  }, [workspacePath]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsLoading(true);
    setErrorMessage(null);

    const bookmark = isJJ ? bookmarkName.trim() : undefined;
    const result = await api.openPR(workspacePath, title.trim(), body, bookmark, draft);

    if ("error" in result) {
      setErrorMessage(result.error);
      setIsLoading(false);
    } else {
      onCreated(result.prURL, bookmark);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && canSubmit) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onDismiss}
    >
      <div
        className="flex flex-col gap-4 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 450,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="text-center">
          <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
            Open PR
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            {isJJ
              ? "Set a bookmark and push to create a PR"
              : "Push current branch and create a PR"}
          </p>
        </div>

        {isJJ && (
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
              Bookmark
            </label>
            <input
              type="text"
              value={bookmarkName}
              onChange={(e) => setBookmarkName(e.target.value)}
              placeholder="e.g. my-feature"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="px-3 py-1.5 rounded text-sm font-mono outline-none"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                border: "1px solid var(--ctp-surface1)",
              }}
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            Title
          </label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR title"
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            Description
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="PR description"
            rows={4}
            className="px-3 py-1.5 rounded text-sm outline-none resize-y"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
              minHeight: 80,
              maxHeight: 200,
            }}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
            className="accent-[var(--ctp-mauve)]"
          />
          <span className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            Open as draft
          </span>
        </label>

        {errorMessage && (
          <p className="text-[11px]" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        {isLoading && (
          <p className="text-[11px] text-center" style={{ color: "var(--ctp-overlay0)" }}>
            Pushing and creating PR...
          </p>
        )}

        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canSubmit ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
              color: canSubmit ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            Open PR
          </button>
        </div>
      </div>
    </div>
  );
}
