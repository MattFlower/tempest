// ============================================================
// FileTreeView — port of FileTreeView.swift
// Shows file list with M/A/D/R status badges and scope selector.
// ============================================================

import type { DiffFile } from "../../../../shared/ipc-types";
import { DiffScope } from "../../../../shared/ipc-types";

interface FileTreeViewProps {
  files: DiffFile[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  scope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
  aiContextPaths?: Set<string>;
}

const STATUS_CONFIG = {
  modified: { label: "M", color: "var(--ctp-blue)" },
  added: { label: "A", color: "var(--ctp-green)" },
  deleted: { label: "D", color: "var(--ctp-red)" },
  renamed: { label: "R", color: "var(--ctp-yellow)" },
} as const;

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function FileTreeView({
  files,
  selectedPath,
  onSelectFile,
  scope,
  onScopeChange,
  aiContextPaths,
}: FileTreeViewProps) {
  const modifiedCount = files.filter((f) => f.status === "modified").length;
  const addedCount = files.filter((f) => f.status === "added").length;
  const deletedCount = files.filter((f) => f.status === "deleted").length;

  return (
    <div className="flex flex-col h-full">
      {/* Summary header */}
      <div
        className="flex-shrink-0 px-3 py-2.5"
        style={{
          background: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        <div
          className="text-sm font-semibold mb-2"
          style={{ color: "var(--ctp-text)" }}
        >
          Changes
        </div>

        {/* Scope buttons */}
        <div className="flex gap-1 mb-2">
          <ScopeButton
            label="Current"
            active={scope === DiffScope.CurrentChange}
            onClick={() => onScopeChange(DiffScope.CurrentChange)}
          />
          <ScopeButton
            label="Since Trunk"
            active={scope === DiffScope.SinceTrunk}
            onClick={() => onScopeChange(DiffScope.SinceTrunk)}
          />
        </div>

        {/* File count summary */}
        <div className="flex gap-2 text-xs">
          {modifiedCount > 0 && (
            <span style={{ color: "var(--ctp-blue)" }}>
              {modifiedCount} modified
            </span>
          )}
          {addedCount > 0 && (
            <span style={{ color: "var(--ctp-green)" }}>
              {addedCount} added
            </span>
          )}
          {deletedCount > 0 && (
            <span style={{ color: "var(--ctp-red)" }}>
              {deletedCount} deleted
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => {
          const path = file.newPath;
          const isSelected = selectedPath === path;
          const cfg = STATUS_CONFIG[file.status];

          return (
            <button
              key={path}
              className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 mx-1 rounded"
              style={{
                background: isSelected
                  ? "var(--ctp-blue)"
                  : "transparent",
                width: "calc(100% - 8px)",
              }}
              onClick={() => onSelectFile(path)}
              title={path}
            >
              {/* Status badge */}
              <span
                className="text-xs font-mono font-semibold w-3.5 text-center flex-shrink-0"
                style={{
                  color: isSelected ? "var(--ctp-base)" : cfg.color,
                }}
              >
                {cfg.label}
              </span>

              {/* File name */}
              <span
                className="text-xs font-mono truncate"
                style={{
                  color: isSelected
                    ? "var(--ctp-base)"
                    : file.status === "deleted"
                      ? "var(--ctp-subtext0)"
                      : "var(--ctp-text)",
                  textDecoration:
                    file.status === "deleted" ? "line-through" : "none",
                }}
              >
                {fileName(path)}
              </span>

              {/* AI badge */}
              {aiContextPaths?.has(path) && (
                <span
                  className="text-[9px] font-bold px-1 py-px rounded-full flex-shrink-0"
                  style={{
                    background: isSelected ? "var(--ctp-base)" : "var(--ctp-mauve)",
                    color: isSelected ? "var(--ctp-mauve)" : "var(--ctp-base)",
                  }}
                >
                  AI
                </span>
              )}

              {/* Directory hint */}
              <span
                className="text-xs truncate ml-auto flex-shrink-0"
                style={{
                  color: isSelected
                    ? "var(--ctp-base)"
                    : "var(--ctp-overlay0)",
                  maxWidth: "40%",
                  opacity: 0.7,
                }}
              >
                {dirPath(path)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScopeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="px-2 py-1 text-xs rounded"
      style={{
        background: active ? "var(--ctp-blue)" : "var(--ctp-surface0)",
        color: active ? "var(--ctp-base)" : "var(--ctp-text)",
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
