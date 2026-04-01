// ============================================================
// VCSFileList — file list with checkboxes for staging/unstaging.
// Grouped into "Staged" and "Unstaged/Untracked" sections.
// ============================================================

import { useCallback } from "react";
import type { VCSFileEntry } from "../../../../shared/ipc-types";

interface VCSFileListProps {
  files: VCSFileEntry[];
  selectedFile: { path: string; staged: boolean } | null;
  onSelectFile: (path: string, staged: boolean) => void;
  onStageFiles: (paths: string[]) => void;
  onUnstageFiles: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  modified: "var(--ctp-blue)",
  added: "var(--ctp-green)",
  deleted: "var(--ctp-red)",
  renamed: "var(--ctp-peach)",
  copied: "var(--ctp-teal)",
  untracked: "var(--ctp-green)",
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
};

function FileRow({
  file,
  isSelected,
  onSelect,
  onToggleStage,
}: {
  file: VCSFileEntry;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStage: () => void;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs group"
      style={{
        backgroundColor: isSelected ? "var(--ctp-surface0)" : "transparent",
      }}
      onClick={onSelect}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--ctp-surface0)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
      }}
    >
      {/* Checkbox for stage/unstage */}
      <input
        type="checkbox"
        checked={file.staged}
        onChange={(e) => {
          e.stopPropagation();
          onToggleStage();
        }}
        className="flex-shrink-0 cursor-pointer accent-[var(--ctp-mauve)]"
        style={{ width: 14, height: 14 }}
      />

      {/* Change type badge */}
      <span
        className="flex-shrink-0 font-mono font-bold"
        style={{ color: CHANGE_TYPE_COLORS[file.changeType] ?? "var(--ctp-text)", minWidth: 12 }}
      >
        {CHANGE_TYPE_LABELS[file.changeType] ?? "?"}
      </span>

      {/* File name and path */}
      <span className="truncate" style={{ color: "var(--ctp-text)" }}>
        {fileName}
      </span>
      {dirPath && (
        <span
          className="truncate flex-shrink-0 ml-auto"
          style={{ color: "var(--ctp-overlay0)", fontSize: 10 }}
        >
          {dirPath}
        </span>
      )}
    </div>
  );
}

export function VCSFileList({
  files,
  selectedFile,
  onSelectFile,
  onStageFiles,
  onUnstageFiles,
  onStageAll,
  onUnstageAll,
}: VCSFileListProps) {
  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const handleToggleStage = useCallback(
    (file: VCSFileEntry) => {
      if (file.staged) {
        onUnstageFiles([file.path]);
      } else {
        onStageFiles([file.path]);
      }
    },
    [onStageFiles, onUnstageFiles],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ backgroundColor: "var(--ctp-base)" }}>
      {/* Staged section */}
      <div className="flex-shrink-0">
        <div
          className="flex items-center justify-between px-2 py-1.5 sticky top-0 z-10"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            borderBottom: "1px solid var(--ctp-surface0)",
          }}
        >
          <span className="text-xs font-semibold" style={{ color: "var(--ctp-green)" }}>
            Staged ({stagedFiles.length})
          </span>
          {stagedFiles.length > 0 && (
            <button
              className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
              style={{ color: "var(--ctp-subtext0)", background: "var(--ctp-surface0)" }}
              onClick={onUnstageAll}
            >
              Unstage All
            </button>
          )}
        </div>
        {stagedFiles.length === 0 ? (
          <div className="px-2 py-2 text-[10px]" style={{ color: "var(--ctp-overlay0)" }}>
            No staged files
          </div>
        ) : (
          stagedFiles.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              file={file}
              isSelected={
                selectedFile?.path === file.path && selectedFile?.staged === true
              }
              onSelect={() => onSelectFile(file.path, true)}
              onToggleStage={() => handleToggleStage(file)}
            />
          ))
        )}
      </div>

      {/* Unstaged section */}
      <div className="flex-shrink-0">
        <div
          className="flex items-center justify-between px-2 py-1.5 sticky top-0 z-10"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            borderBottom: "1px solid var(--ctp-surface0)",
            borderTop: "1px solid var(--ctp-surface0)",
          }}
        >
          <span className="text-xs font-semibold" style={{ color: "var(--ctp-blue)" }}>
            Changes ({unstagedFiles.length})
          </span>
          {unstagedFiles.length > 0 && (
            <button
              className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
              style={{ color: "var(--ctp-subtext0)", background: "var(--ctp-surface0)" }}
              onClick={onStageAll}
            >
              Stage All
            </button>
          )}
        </div>
        {unstagedFiles.length === 0 ? (
          <div className="px-2 py-2 text-[10px]" style={{ color: "var(--ctp-overlay0)" }}>
            No unstaged changes
          </div>
        ) : (
          unstagedFiles.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              file={file}
              isSelected={
                selectedFile?.path === file.path && selectedFile?.staged === false
              }
              onSelect={() => onSelectFile(file.path, false)}
              onToggleStage={() => handleToggleStage(file)}
            />
          ))
        )}
      </div>
    </div>
  );
}
