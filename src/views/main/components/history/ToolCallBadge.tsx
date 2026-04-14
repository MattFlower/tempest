// ============================================================
// ToolCallBadge — Port of ToolCallView.swift
// Compact badge: tool name + summary, expandable to show full input.
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { diffLines } from "diff";
import type { ToolCallInfo } from "../../../../shared/ipc-types";

/** Tools that should be completely hidden from the viewer */
export const HIDDEN_TOOLS = new Set(["ToolSearch"]);

interface ToolCallBadgeProps {
  toolCall: ToolCallInfo;
}

/** Color-code tool types */
function toolColor(tool: string): string {
  switch (tool) {
    case "Bash":
      return "var(--ctp-green)";
    case "Read":
      return "var(--ctp-blue)";
    case "Grep":
    case "Glob":
      return "var(--ctp-sapphire)";
    case "Edit":
    case "Write":
      return "var(--ctp-peach)";
    case "Skill":
      return "var(--ctp-mauve)";
    case "Agent":
      return "var(--ctp-pink)";
    case "TaskCreate":
    case "TaskUpdate":
      return "var(--ctp-yellow)";
    default:
      return "var(--ctp-overlay1)";
  }
}

/** Tools that always show their primary param inline regardless of total param count */
const ALWAYS_INLINE = new Set([
  "Bash", "Read", "Edit", "Write", "Grep", "Glob", "Skill", "Agent", "TaskCreate",
]);

/** Whether to show the summary inline on the collapsed header line */
function showInlineSummary(toolCall: ToolCallInfo): boolean {
  if (toolCall.tool === "TaskUpdate") return false;
  if (ALWAYS_INLINE.has(toolCall.tool)) return true;
  return (toolCall.inputParamCount ?? 1) <= 1;
}

/** Format the summary for display, with special handling for certain tools */
function displaySummary(toolCall: ToolCallInfo): string {
  if (toolCall.tool === "Skill") {
    if (toolCall.input) {
      try {
        const json = JSON.parse(toolCall.input);
        if (typeof json.skill === "string") return json.skill;
      } catch {}
    }
    const summary = toolCall.summary;
    if (summary.startsWith("Skill ")) return summary.slice(6);
    return summary;
  }
  if (toolCall.tool === "TaskCreate" && toolCall.input) {
    try {
      const json = JSON.parse(toolCall.input);
      if (typeof json.subject === "string") return json.subject;
    } catch {}
  }
  return toolCall.summary;
}

/** Keys to exclude from expanded param display */
function excludedParamKeys(tool: string): Set<string> {
  switch (tool) {
    case "Skill":
      return new Set(["skill"]);
    case "TaskCreate":
      return new Set(["subject"]);
    default:
      return new Set();
  }
}

/** Threshold for auto-collapsing diffs */
const DIFF_COLLAPSE_LINES = 10;

interface DiffLine {
  type: "added" | "removed" | "context";
  text: string;
}

/** Compute unified diff lines from old_string / new_string */
function computeDiffLines(oldStr: string, newStr: string): DiffLine[] {
  const changes = diffLines(oldStr, newStr);
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, "").split("\n");
    const type: DiffLine["type"] = change.added
      ? "added"
      : change.removed
        ? "removed"
        : "context";
    for (const line of changeLines) {
      lines.push({ type, text: line });
    }
  }
  return lines;
}

/** Try to extract edit diff info from an Edit tool call */
function parseEditDiff(
  toolCall: ToolCallInfo,
): { filePath: string; lines: DiffLine[] } | null {
  if (toolCall.tool !== "Edit" || !toolCall.input) return null;
  try {
    const json = JSON.parse(toolCall.input);

    // Claude shape: { file_path, old_string, new_string }
    if (
      typeof json.old_string === "string" &&
      typeof json.new_string === "string"
    ) {
      return {
        filePath: json.file_path ?? "",
        lines: computeDiffLines(json.old_string, json.new_string),
      };
    }

    // Pi shape: { path, edits: [{ oldText, newText }, ...] }
    // Each entry is an independent find/replace; concatenate them into a
    // single diff with a separator so we can reuse the same renderer.
    if (Array.isArray(json.edits) && typeof json.path === "string") {
      const lines: DiffLine[] = [];
      json.edits.forEach((edit: any, i: number) => {
        if (
          typeof edit?.oldText !== "string" ||
          typeof edit?.newText !== "string"
        ) {
          return;
        }
        if (i > 0) {
          lines.push({ type: "context", text: "" });
        }
        lines.push(...computeDiffLines(edit.oldText, edit.newText));
      });
      if (lines.length === 0) return null;
      return { filePath: json.path, lines };
    }

    return null;
  } catch {
    return null;
  }
}

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  const [isCollapsed, setIsCollapsed] = useState(lines.length > DIFF_COLLAPSE_LINES);

  return (
    <div className="mx-2.5 rounded overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.25)" }}>
      {isCollapsed ? (
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/5 cursor-pointer"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {lines.filter((l) => l.type === "removed").length} removed, {lines.filter((l) => l.type === "added").length} added — click to expand ({lines.length} lines)
        </button>
      ) : (
        <>
          {lines.length > DIFF_COLLAPSE_LINES && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="w-full text-left px-3 py-1 text-[10px] font-mono hover:bg-white/5 cursor-pointer"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              collapse
            </button>
          )}
          <pre className="text-xs font-mono leading-[1.4] overflow-x-auto select-text px-3 py-1.5">
            {lines.map((line, i) => {
              const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
              const color =
                line.type === "added"
                  ? "var(--ctp-green)"
                  : line.type === "removed"
                    ? "var(--ctp-red)"
                    : "var(--ctp-subtext0)";
              const bg =
                line.type === "added"
                  ? "rgba(94,200,94,0.1)"
                  : line.type === "removed"
                    ? "rgba(235,111,146,0.1)"
                    : "transparent";
              return (
                <div key={i} style={{ color, backgroundColor: bg }}>
                  {prefix} {line.text}
                </div>
              );
            })}
          </pre>
        </>
      )}
    </div>
  );
}

/** Parse the fullInput JSON into key-value pairs for structured display */
function parsedParams(
  toolCall: ToolCallInfo,
): Array<{ key: string; value: string }> | null {
  if (!toolCall.input) return null;
  try {
    const json = JSON.parse(toolCall.input);
    if (typeof json !== "object" || json === null) return null;
    const excluded = excludedParamKeys(toolCall.tool);
    const params: Array<{ key: string; value: string }> = [];
    for (const key of Object.keys(json).sort()) {
      if (excluded.has(key)) continue;
      const value = json[key];
      if (typeof value === "string") {
        params.push({ key, value });
      } else if (typeof value === "number" || typeof value === "boolean") {
        params.push({ key, value: String(value) });
      } else {
        try {
          params.push({ key, value: JSON.stringify(value, null, 2) });
        } catch {
          params.push({ key, value: String(value) });
        }
      }
    }
    return params.length > 0 ? params : null;
  } catch {
    return null;
  }
}

export function ToolCallBadge({ toolCall }: ToolCallBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const color = toolColor(toolCall.tool);
  const inlineSummary = showInlineSummary(toolCall);
  const summary = useMemo(() => displaySummary(toolCall), [toolCall]);
  const params = useMemo(() => parsedParams(toolCall), [toolCall]);
  const editDiff = useMemo(() => parseEditDiff(toolCall), [toolCall]);
  const toggle = useCallback(() => setIsExpanded((p) => !p), []);

  return (
    <div
      className="rounded"
      style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
    >
      {/* Header row (always visible) */}
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 hover:bg-white/5 rounded cursor-pointer"
      >
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {isExpanded ? "\u25BC" : "\u25B6"}
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span
          className="text-xs font-semibold font-mono"
          style={{ color: "var(--ctp-text)" }}
        >
          {toolCall.tool}
        </span>
        {inlineSummary && (
          <span
            className="text-xs font-mono truncate"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {summary}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="pb-2">
          {editDiff ? (
            <UnifiedDiff lines={editDiff.lines} />
          ) : params && params.length > 0 ? (
            <div
              className="mx-2.5 p-2.5 rounded space-y-1"
              style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
            >
              {params.map((param) => (
                <div key={param.key}>
                  <div
                    className="text-[10px] font-semibold"
                    style={{ color: "var(--ctp-overlay0)" }}
                  >
                    {param.key}
                  </div>
                  <div
                    className="text-xs font-mono break-all select-text"
                    style={{
                      color: "var(--ctp-text)",
                      ...(param.value.length > 200
                        ? {
                            display: "-webkit-box",
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: "vertical" as const,
                            overflow: "hidden",
                          }
                        : {}),
                    }}
                  >
                    {param.value}
                  </div>
                </div>
              ))}
            </div>
          ) : toolCall.input ? (
            <div
              className="mx-2.5 p-2.5 text-xs font-mono break-all rounded select-text"
              style={{
                color: "var(--ctp-text)",
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              {toolCall.input}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
