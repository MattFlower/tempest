// ============================================================
// InlineDiff — compact inline unified diff for AI Context Panel.
// Renders oldString→newString edits as colored diff lines.
// ============================================================

import { useMemo, useState } from "react";
import { diffLines } from "diff";
import type { ToolChangeDetail } from "../../../../shared/ipc-types";

interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

const MAX_VISIBLE_LINES = 15;

const STYLES = {
  add: { background: "rgba(46, 160, 67, 0.18)", prefix: "+" },
  remove: { background: "rgba(248, 81, 73, 0.13)", prefix: "-" },
  context: { background: "transparent", prefix: " " },
} as const;

export function InlineDiff({ detail }: { detail: ToolChangeDetail }) {
  if (detail.type === "unknown") {
    return (
      <div className="px-2 pb-1.5 text-xs" style={{ color: "var(--ctp-subtext0)" }}>
        {detail.summary}
      </div>
    );
  }

  if (detail.type === "write") {
    return <EditDiff oldString="" newString={detail.fullContent} />;
  }

  return <EditDiff oldString={detail.oldString} newString={detail.newString} />;
}

function EditDiff({ oldString, newString }: { oldString: string; newString: string }) {
  const [showAll, setShowAll] = useState(false);

  const { lines, addedCount, removedCount } = useMemo(() => {
    const changes = diffLines(oldString, newString);
    const result: DiffLine[] = [];
    let added = 0;
    let removed = 0;

    for (const change of changes) {
      // Split into individual lines, removing trailing empty from split
      const rawLines = change.value.split("\n");
      // If the value ends with \n, split produces an empty trailing element
      if (rawLines[rawLines.length - 1] === "") rawLines.pop();

      const type: DiffLine["type"] = change.added ? "add" : change.removed ? "remove" : "context";

      for (const line of rawLines) {
        result.push({ type, text: line });
        if (type === "add") added++;
        if (type === "remove") removed++;
      }
    }

    return { lines: result, addedCount: added, removedCount: removed };
  }, [oldString, newString]);

  const isTruncated = !showAll && lines.length > MAX_VISIBLE_LINES;
  const visibleLines = isTruncated ? lines.slice(0, MAX_VISIBLE_LINES) : lines;
  const hiddenCount = lines.length - MAX_VISIBLE_LINES;

  return (
    <div className="pb-1.5">
      {/* Summary */}
      <div
        className="flex items-center gap-1 px-2 pb-1 text-xs"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        <span>└</span>
        {addedCount > 0 && (
          <span style={{ color: "var(--ctp-green)" }}>
            Added {addedCount} {addedCount === 1 ? "line" : "lines"}
          </span>
        )}
        {addedCount > 0 && removedCount > 0 && <span>,</span>}
        {removedCount > 0 && (
          <span style={{ color: "var(--ctp-red)" }}>
            removed {removedCount} {removedCount === 1 ? "line" : "lines"}
          </span>
        )}
      </div>

      {/* Diff lines */}
      <div
        className="mx-2 rounded overflow-hidden"
        style={{ border: "1px solid var(--ctp-surface0)" }}
      >
        {visibleLines.map((line, i) => {
          const style = STYLES[line.type];
          return (
            <div
              key={i}
              className="flex"
              style={{
                background: style.background,
                fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
                fontSize: 11,
                lineHeight: "18px",
              }}
            >
              <span
                className="w-5 text-center select-none flex-shrink-0"
                style={{
                  color:
                    line.type === "add"
                      ? "var(--ctp-green)"
                      : line.type === "remove"
                        ? "var(--ctp-red)"
                        : "var(--ctp-overlay0)",
                }}
              >
                {style.prefix}
              </span>
              <span
                className="flex-1 whitespace-pre overflow-hidden text-ellipsis"
                style={{ color: "var(--ctp-text)" }}
              >
                {line.text}
              </span>
            </div>
          );
        })}

        {isTruncated && (
          <button
            className="w-full text-center text-xs py-1 cursor-pointer hover:bg-white/5"
            style={{
              color: "var(--ctp-blue)",
              background: "var(--ctp-surface0)",
              border: "none",
            }}
            onClick={() => setShowAll(true)}
          >
            Show {hiddenCount} more {hiddenCount === 1 ? "line" : "lines"}
          </button>
        )}
      </div>
    </div>
  );
}
