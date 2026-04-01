// ============================================================
// JJRevisionLog — left panel showing jj log with DAG graph.
// Renders graph characters (@ ○ ◆ │ ╭─╯ ~) in a monospace column
// alongside revision entries with change-id, description, bookmarks,
// and working-copy badges.
// ============================================================

import type { JJRevision } from "../../../../shared/ipc-types";

interface JJRevisionLogProps {
  revisions: JJRevision[];
  selectedChangeId: string | null;
  currentChangeId: string;
  onSelectRevision: (changeId: string) => void;
  onContextMenu?: (changeId: string, x: number, y: number) => void;
}

// --- Color helpers ---

const CHANGE_COLORS = [
  "var(--ctp-mauve)",
  "var(--ctp-blue)",
  "var(--ctp-green)",
  "var(--ctp-peach)",
  "var(--ctp-teal)",
  "var(--ctp-pink)",
  "var(--ctp-yellow)",
  "var(--ctp-lavender)",
  "var(--ctp-sky)",
  "var(--ctp-flamingo)",
];

function changeColor(changeId: string): string {
  let hash = 0;
  for (let i = 0; i < changeId.length; i++) {
    hash = (hash * 31 + changeId.charCodeAt(i)) | 0;
  }
  return CHANGE_COLORS[Math.abs(hash) % CHANGE_COLORS.length]!;
}

const BOOKMARK_COLORS: Record<string, string> = {
  main: "var(--ctp-green)",
  master: "var(--ctp-green)",
};

function bookmarkColor(name: string): string {
  return BOOKMARK_COLORS[name] ?? "var(--ctp-mauve)";
}

// --- Graph rendering helpers ---

// Node characters that jj uses in its graph
const NODE_CHARS = new Set(["@", "○", "◆", "◇", "●", "◉"]);

/**
 * Generate a continuation graph line from a node graph prefix.
 * Replaces the node character (@ ○ ◆) with │ to show the line continuing.
 */
function synthesizeContinuationLine(nodeGraphPrefix: string): string {
  let result = "";
  for (const ch of nodeGraphPrefix) {
    if (NODE_CHARS.has(ch)) {
      result += "│";
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Colorize graph characters for display.
 * Returns an array of {char, color} spans.
 */
function colorizeGraph(
  graphStr: string,
  isWorkingCopy: boolean,
): { text: string; color: string }[] {
  const spans: { text: string; color: string }[] = [];
  let current = "";
  let currentColor = "var(--ctp-overlay0)";

  const flush = () => {
    if (current) {
      spans.push({ text: current, color: currentColor });
      current = "";
    }
  };

  for (const ch of graphStr) {
    if (ch === "@") {
      flush();
      spans.push({
        text: ch,
        color: isWorkingCopy ? "var(--ctp-mauve)" : "var(--ctp-blue)",
      });
    } else if (ch === "◆" || ch === "●" || ch === "◉") {
      flush();
      spans.push({ text: ch, color: "var(--ctp-green)" });
    } else if (ch === "○" || ch === "◇") {
      flush();
      spans.push({ text: ch, color: "var(--ctp-overlay1)" });
    } else if (ch === "~") {
      flush();
      spans.push({ text: ch, color: "var(--ctp-overlay0)" });
    } else {
      // Line chars (│ ├ ╭ ╮ ╰ ╯ ─) and spaces — accumulate
      const lineColor = "var(--ctp-surface2)";
      if (currentColor !== lineColor) {
        flush();
        currentColor = lineColor;
      }
      current += ch;
    }
  }
  flush();

  return spans;
}

// --- Graph column component ---

function GraphColumn({
  graphStr,
  isWorkingCopy,
}: {
  graphStr: string;
  isWorkingCopy: boolean;
}) {
  const spans = colorizeGraph(graphStr, isWorkingCopy);
  return (
    <span className="font-mono text-[12px] leading-[18px] whitespace-pre flex-shrink-0 select-none">
      {spans.map((s, i) => (
        <span key={i} style={{ color: s.color }}>
          {s.text}
        </span>
      ))}
    </span>
  );
}

// --- Revision entry ---

function RevisionEntry({
  revision,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  revision: JJRevision;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu?: (x: number, y: number) => void;
}) {
  const color = changeColor(revision.changeId);
  const description = revision.description || "(no description)";
  const isDescriptionEmpty = !revision.description;
  const continuationLine = synthesizeContinuationLine(revision.nodeGraphPrefix);
  const hasLabels =
    revision.bookmarks.length > 0 || revision.workingCopies.length > 0;

  return (
    <div
      className="cursor-pointer transition-colors"
      style={{
        backgroundColor: isSelected ? "var(--ctp-surface0)" : "transparent",
      }}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e.clientX, e.clientY);
      }}
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
      {/* Line 1: graph node + change-id + description */}
      <div className="flex items-baseline min-w-0 px-1">
        <GraphColumn
          graphStr={revision.nodeGraphPrefix}
          isWorkingCopy={revision.isWorkingCopy}
        />
        <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
          <span
            className="font-mono text-[11px] font-bold flex-shrink-0"
            style={{ color }}
          >
            {revision.changeId}
          </span>
          <span
            className="text-xs truncate"
            style={{
              color: isDescriptionEmpty
                ? "var(--ctp-overlay0)"
                : "var(--ctp-text)",
              fontStyle: isDescriptionEmpty ? "italic" : "normal",
            }}
          >
            {description}
          </span>
        </div>
      </div>

      {/* Line 2: graph continuation + commit hash, author, timestamp */}
      <div className="flex items-baseline min-w-0 px-1">
        <GraphColumn
          graphStr={continuationLine}
          isWorkingCopy={false}
        />
        <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
          <span
            className="font-mono text-[10px] flex-shrink-0"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            {revision.commitId}
          </span>
          <span
            className="text-[10px] truncate"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {revision.author}
          </span>
          <span
            className="text-[10px] flex-shrink-0 ml-auto pr-1"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {revision.timestamp}
          </span>
        </div>
      </div>

      {/* Line 3 (optional): graph continuation + badges (bookmarks + working copies) */}
      {hasLabels && (
        <div className="flex items-center min-w-0 px-1 pb-0.5">
          <GraphColumn
            graphStr={continuationLine}
            isWorkingCopy={false}
          />
          <div className="flex items-center gap-1 flex-wrap">
            {revision.workingCopies.map((wc) => (
              <span
                key={`wc-${wc}`}
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: "var(--ctp-sky)",
                  color: "var(--ctp-base)",
                }}
              >
                {wc}@
              </span>
            ))}
            {revision.bookmarks.map((bm) => (
              <span
                key={`bm-${bm}`}
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: bookmarkColor(bm),
                  color: "var(--ctp-base)",
                }}
              >
                {bm}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Line 4 (optional): empty/immutable indicators */}
      {(revision.isEmpty || revision.isImmutable) && (
        <div className="flex items-baseline min-w-0 px-1 pb-0.5">
          <GraphColumn
            graphStr={continuationLine}
            isWorkingCopy={false}
          />
          <div className="flex items-center gap-1">
            {revision.isEmpty && (
              <span
                className="text-[9px]"
                style={{ color: "var(--ctp-overlay0)" }}
              >
                (empty)
              </span>
            )}
            {revision.isImmutable && (
              <span
                className="text-[9px]"
                style={{ color: "var(--ctp-overlay0)" }}
              >
                (immutable)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Graph-only row (merge lines, elided revisions, blank lines) ---

function GraphOnlyRow({ line }: { line: string }) {
  if (!line.trim()) return null; // skip blank lines

  return (
    <div className="flex items-baseline min-w-0 px-1">
      <span
        className="font-mono text-[12px] leading-[18px] whitespace-pre select-none"
        style={{ color: "var(--ctp-surface2)" }}
      >
        {line}
      </span>
    </div>
  );
}

// --- Main component ---

export function JJRevisionLog({
  revisions,
  selectedChangeId,
  currentChangeId,
  onSelectRevision,
  onContextMenu,
}: JJRevisionLogProps) {
  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ backgroundColor: "var(--ctp-base)" }}
    >
      {revisions.length === 0 ? (
        <div
          className="flex items-center justify-center h-full text-xs"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          No revisions found
        </div>
      ) : (
        revisions.map((rev, idx) => (
          <div key={rev.changeId + rev.commitId}>
            <RevisionEntry
              revision={rev}
              isSelected={selectedChangeId === rev.changeId}
              onSelect={() => onSelectRevision(rev.changeId)}
              onContextMenu={
                onContextMenu
                  ? (x, y) => onContextMenu(rev.changeId, x, y)
                  : undefined
              }
            />
            {/* Trailing graph lines (merge, elided, etc.) */}
            {rev.trailingGraphLines.map((line, lineIdx) => (
              <GraphOnlyRow key={`trail-${idx}-${lineIdx}`} line={line} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
