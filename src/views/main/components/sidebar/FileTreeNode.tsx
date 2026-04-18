import type { ReactNode } from "react";

export type TreeNodeKind = "repo" | "workspace" | "dir" | "file";

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  depth: number;
  label: string;
  expandable: boolean;
  isExpanded: boolean;
  fullPath?: string;
  workspacePath?: string;
  repoId?: string;
  /** True for the workspace row whose panes are currently visible. */
  isFocusedWorkspace?: boolean;
  /** True for the file row whose path matches the focused tab's file path. */
  isActiveFile?: boolean;
  /** Branch / subtext shown at the end of the row (dimmed). */
  trailingMeta?: string;
  /** Optional extension shorthand (ts/tsx/md/json/css) for file icon styling. */
  fileExtKey?: string;
}

interface Props {
  node: TreeNode;
  isCursor: boolean;
  onClick: (node: TreeNode, event: React.MouseEvent) => void;
  onContextMenu?: (node: TreeNode, event: React.MouseEvent) => void;
  rowRef?: React.Ref<HTMLDivElement>;
}

function Chevron({ hidden, expanded }: { hidden: boolean; expanded: boolean }) {
  return (
    <span
      aria-hidden
      className="flex-shrink-0 w-3 flex items-center justify-center"
      style={{
        color: "var(--ctp-overlay0)",
        visibility: hidden ? "hidden" : "visible",
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="currentColor"
        style={{
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 120ms",
        }}
      >
        <path d="M6.427 4.427l3.396 3.396a.25.25 0 0 1 0 .354l-3.396 3.396A.25.25 0 0 1 6 11.396V4.604a.25.25 0 0 1 .427-.177Z" />
      </svg>
    </span>
  );
}

function NodeIcon({ node }: { node: TreeNode }) {
  const base = "flex-shrink-0 w-4 flex items-center justify-center";
  switch (node.kind) {
    case "repo":
      return (
        <span className={base} style={{ color: "var(--ctp-mauve)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8zM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2z" />
          </svg>
        </span>
      );
    case "workspace":
      return (
        <span className={base} style={{ color: "var(--ctp-teal)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.49 2.49 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm8 0a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
          </svg>
        </span>
      );
    case "dir":
      return (
        <span className={base} style={{ color: "var(--ctp-yellow)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1z" />
          </svg>
        </span>
      );
    case "file": {
      const color = fileColor(node.fileExtKey);
      return (
        <span className={base} style={{ color }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.914 3.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-3.914-3.914z" />
          </svg>
        </span>
      );
    }
  }
}

function fileColor(key?: string): string {
  switch (key) {
    case "ts":
    case "tsx":
      return "var(--ctp-blue)";
    case "md":
      return "var(--ctp-subtext0)";
    case "json":
      return "var(--ctp-peach)";
    case "css":
      return "var(--ctp-mauve)";
    default:
      return "var(--ctp-overlay1)";
  }
}

export function FileTreeNode({ node, isCursor, onClick, onContextMenu, rowRef }: Props) {
  const indentPx = 6 + node.depth * 14;

  let background: string | undefined;
  if (node.isActiveFile) {
    background = "color-mix(in srgb, var(--ctp-blue) 18%, transparent)";
  } else if (isCursor) {
    background = "var(--ctp-surface0)";
  }

  const trailing: ReactNode = node.trailingMeta ? (
    <span
      className="ml-auto flex-shrink-0 text-[10px] truncate"
      style={{ color: "var(--ctp-overlay1)", maxWidth: 100 }}
    >
      {node.trailingMeta}
    </span>
  ) : null;

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={node.expandable ? node.isExpanded : undefined}
      aria-selected={isCursor}
      onClick={(e) => onClick(node, e)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(node, e);
        }
      }}
      className="relative flex items-center gap-1.5 text-[12px] py-[3px] pr-2 cursor-pointer hover:bg-[var(--ctp-surface0)]"
      style={{
        paddingLeft: indentPx,
        background,
        color: "var(--ctp-text)",
      }}
    >
      {node.isActiveFile && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px]"
          style={{ backgroundColor: "var(--ctp-blue)" }}
        />
      )}
      <Chevron hidden={!node.expandable} expanded={node.isExpanded} />
      <NodeIcon node={node} />
      <span className="truncate">{node.label}</span>
      {trailing}
      {node.isFocusedWorkspace && (
        <span
          aria-hidden
          className="ml-1 flex-shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: "var(--ctp-green)" }}
        />
      )}
    </div>
  );
}
