import { useState, useEffect, useRef } from "react";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  repoId: string;
  onStartReview: (prNumber: number) => void;
  onDismiss: () => void;
  isLoading: boolean;
  errorMessage: string | null;
}

export function PRReviewDialog({ repoId, onStartReview, onDismiss, isLoading, errorMessage }: Props) {
  useOverlay();
  const [prNumberText, setPrNumberText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prNumber = parseInt(prNumberText, 10);
  const isValid = !isNaN(prNumber) && prNumber > 0;
  const canSubmit = isValid && !isLoading;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onStartReview(prNumber);
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
          width: 380,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="text-center">
          <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
            PR Review
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            Enter a pull request number to start reviewing
          </p>
        </div>

        <div className="flex items-center gap-1">
          <span
            className="text-lg font-mono"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            #
          </span>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={prNumberText}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, "");
              setPrNumberText(val);
            }}
            placeholder="e.g. 142"
            autoComplete="off"
            className="flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          />
        </div>

        {errorMessage && (
          <p className="text-[11px]" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        {isLoading && (
          <p className="text-[11px] text-center" style={{ color: "var(--ctp-overlay0)" }}>
            Fetching PR and creating workspace...
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
            onClick={() => canSubmit && onStartReview(prNumber)}
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canSubmit ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
              color: canSubmit ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            Start Review
          </button>
        </div>
      </div>
    </div>
  );
}
