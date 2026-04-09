// ============================================================
// GitScopedFileList — read-only file list for scoped views
// (single commit or since-trunk). No staging checkboxes.
// ============================================================

import type { GitScopedFileEntry } from "../../../../shared/ipc-types";

interface GitScopedFileListProps {
  files: GitScopedFileEntry[];
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  summary: string;
  aiContextPaths?: Set<string>;
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  modified: "var(--ctp-blue)",
  added: "var(--ctp-green)",
  deleted: "var(--ctp-red)",
  renamed: "var(--ctp-peach)",
  copied: "var(--ctp-teal)",
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
};

export function GitScopedFileList({
  files,
  selectedFilePath,
  onSelectFile,
  summary,
  aiContextPaths,
}: GitScopedFileListProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ backgroundColor: "var(--ctp-base)" }}>
      {/* Summary header */}
      <div
        className="flex items-center justify-between px-2 py-1.5 sticky top-0 z-10"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        <span className="text-xs font-semibold truncate" style={{ color: "var(--ctp-text)" }}>
          {summary}
        </span>
        <span
          className="text-[10px] flex-shrink-0 ml-2"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* File list */}
      {files.length === 0 ? (
        <div className="px-2 py-3 text-[10px] text-center" style={{ color: "var(--ctp-overlay0)" }}>
          No files changed
        </div>
      ) : (
        files.map((file) => {
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";
          const isSelected = selectedFilePath === file.path;

          return (
            <div
              key={file.path}
              className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs"
              style={{
                backgroundColor: isSelected ? "var(--ctp-surface0)" : "transparent",
              }}
              onClick={() => onSelectFile(file.path)}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.backgroundColor = "var(--ctp-surface0)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              <span
                className="flex-shrink-0 font-mono font-bold"
                style={{
                  color: CHANGE_TYPE_COLORS[file.changeType] ?? "var(--ctp-text)",
                  minWidth: 12,
                }}
              >
                {CHANGE_TYPE_LABELS[file.changeType] ?? "?"}
              </span>
              <span className="truncate" style={{ color: "var(--ctp-text)" }}>
                {fileName}
              </span>
              {aiContextPaths?.has(file.path) && (
                <span
                  className="text-[9px] font-bold px-1 py-px rounded-full flex-shrink-0"
                  style={{
                    background: "var(--ctp-mauve)",
                    color: "var(--ctp-base)",
                  }}
                  title="Claude has edited this file"
                >
                  AI
                </span>
              )}
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
        })
      )}
    </div>
  );
}
