import { useState } from "react";
import { useStore } from "../../state/store";
import { useOverlay } from "../../state/useOverlay";

export function CreateClaudeSettingsDialog() {
  const req = useStore((s) => s.createClaudeSettingsRequest);
  const hide = useStore((s) => s.hideCreateClaudeSettingsDialog);

  if (!req) return null;
  return <DialogBody path={req.path} onConfirm={req.onConfirm} onDismiss={hide} />;
}

function DialogBody({
  path,
  onConfirm,
  onDismiss,
}: {
  path: string;
  onConfirm: () => Promise<void> | void;
  onDismiss: () => void;
}) {
  useOverlay();
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    setErrorMessage(null);
    try {
      await onConfirm();
      onDismiss();
    } catch (e: any) {
      setErrorMessage(e?.message ?? "Failed to create file");
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreating) {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape" && !isCreating) {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={() => { if (!isCreating) onDismiss(); }}
    >
      <div
        className="flex flex-col gap-3 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 440,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        <h2 className="text-base font-bold" style={{ color: "var(--ctp-text)" }}>
          Create Claude settings file?
        </h2>
        <p className="text-[13px]" style={{ color: "var(--ctp-subtext0)" }}>
          No settings file exists at this path yet. Create an empty one?
        </p>
        <code
          className="text-[11px] px-2 py-1.5 rounded break-all"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-overlay1)",
          }}
        >
          {path}
        </code>

        {errorMessage && (
          <p className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--ctp-red)" }}>
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            disabled={isCreating}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)", opacity: isCreating ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: "var(--ctp-mauve)",
              color: "var(--ctp-base)",
              opacity: isCreating ? 0.5 : 1,
              cursor: isCreating ? "not-allowed" : "pointer",
            }}
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
