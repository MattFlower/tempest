// ============================================================
// JJChangeDetail — right panel header showing revision info,
// editable description, and abandon button.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { JJRevision } from "../../../../shared/ipc-types";

interface JJChangeDetailProps {
  revision: JJRevision | null;
  onDescriptionSave: (description: string) => void;
  onAbandon: () => void;
  isSaving: boolean;
}

export function JJChangeDetail({
  revision,
  onDescriptionSave,
  onAbandon,
  isSaving,
}: JJChangeDetailProps) {
  const [description, setDescription] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync description with selected revision
  useEffect(() => {
    if (revision) {
      setDescription(revision.description);
      setIsDirty(false);
    }
  }, [revision?.changeId]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [description]);

  const handleSave = useCallback(() => {
    onDescriptionSave(description);
    setIsDirty(false);
  }, [description, onDescriptionSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  if (!revision) {
    return (
      <div
        className="flex items-center justify-center h-full text-xs"
        style={{ color: "var(--ctp-overlay0)" }}
      >
        Select a revision to view details
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: Author + commit hash + abandon */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-xs font-bold"
            style={{ color: "var(--ctp-mauve)" }}
          >
            {revision.changeId}
          </span>
          <span className="text-xs truncate" style={{ color: "var(--ctp-text)" }}>
            {revision.author}
          </span>
          <span className="text-[10px]" style={{ color: "var(--ctp-overlay0)" }}>
            &lt;{revision.email}&gt;
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            {revision.commitId}
          </span>
          {!revision.isImmutable && (
            <button
              onClick={onAbandon}
              className="px-2 py-1 text-[10px] font-medium rounded transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--ctp-red)",
                color: "var(--ctp-base)",
              }}
            >
              Abandon
            </button>
          )}
        </div>
      </div>

      {/* Description editor */}
      <div
        className="flex flex-col px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--ctp-text)" }}
          >
            Description
          </span>
          {!revision.isImmutable && (
            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="px-2.5 py-1 text-[10px] font-medium rounded transition-colors"
              style={{
                backgroundColor:
                  isDirty && !isSaving ? "var(--ctp-mauve)" : "var(--ctp-surface0)",
                color:
                  isDirty && !isSaving ? "var(--ctp-base)" : "var(--ctp-overlay0)",
                cursor: isDirty && !isSaving ? "pointer" : "default",
                opacity: isDirty && !isSaving ? 1 : 0.5,
              }}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setIsDirty(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="No description"
          readOnly={revision.isImmutable}
          className="w-full text-xs rounded px-2 py-1.5 resize-none outline-none"
          style={{
            backgroundColor: "var(--ctp-base)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface1)",
            minHeight: 36,
            maxHeight: 120,
          }}
          rows={2}
        />
      </div>

    </div>
  );
}
