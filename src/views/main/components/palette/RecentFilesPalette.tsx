import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PaneTabKind } from "../../../../shared/ipc-types";
import { createTab, allPanes } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { OverlayWrapper } from "../../state/useOverlay";
import { api } from "../../state/rpc-client";
import { fuzzyMatch } from "./fuzzy-match";
import { addTab, splitPane } from "../../state/actions";

function addTabToFocusedPane(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  const { focusedPaneId, config } = useStore.getState();
  if (!focusedPaneId) return;

  const isMonacoDefault = config?.editor === "monaco";
  const needsTerminalId = kind === PaneTabKind.Editor && !isMonacoDefault;

  const tab = createTab(kind, label, {
    ...(needsTerminalId ? { terminalId: crypto.randomUUID() } : {}),
    ...overrides,
  });
  addTab(focusedPaneId, tab);
}

export function RecentFilesPalette() {
  const visible = useStore((s) => s.recentFilesPaletteVisible);
  const toggle = useStore((s) => s.toggleRecentFilesPalette);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const paneTree = useStore((s) =>
    s.selectedWorkspacePath ? s.paneTrees[s.selectedWorkspacePath] : undefined,
  );

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Files currently open in this workspace (any pane, any tab). Recents are
  // meant for files you've *closed* and want to get back to, so we hide
  // anything still on screen. Reactive: closing a tab pops it back in.
  const openFilePaths = useMemo(() => {
    const set = new Set<string>();
    if (!paneTree) return set;
    for (const pane of allPanes(paneTree)) {
      for (const tab of pane.tabs) {
        if (tab.editorFilePath) set.add(tab.editorFilePath);
        if (tab.markdownFilePath) set.add(tab.markdownFilePath);
      }
    }
    return set;
  }, [paneTree]);

  // Hide currently-open files, then fuzzy-filter while preserving recency
  // order — the list is MRU-ordered and that's the whole point.
  const closedRecents = files.filter((f) => !openFilePaths.has(f));
  const displayFiles = query
    ? closedRecents.filter((f) => {
        const name = f.split("/").pop() ?? f;
        return fuzzyMatch(query, name) !== null || fuzzyMatch(query, f) !== null;
      })
    : closedRecents;

  // Load recent files when the palette opens or workspace changes
  useEffect(() => {
    if (!visible || !selectedWorkspacePath) return;
    setLoading(true);
    api.getRecentFiles(selectedWorkspacePath).then((result: string[]) => {
      setFiles(result);
      setLoading(false);
    }).catch(() => {
      setFiles([]);
      setLoading(false);
    });
  }, [visible, selectedWorkspacePath]);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible]);

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const dismiss = useCallback(() => toggle(), [toggle]);

  const openFile = useCallback((filePath: string) => {
    const name = filePath.split("/").pop() ?? "File";
    if (/\.(?:md|markdown)$/i.test(name)) {
      addTabToFocusedPane(PaneTabKind.MarkdownViewer, name, { markdownFilePath: filePath });
    } else {
      addTabToFocusedPane(PaneTabKind.Editor, name, { editorFilePath: filePath });
    }
  }, []);

  const executeSelected = useCallback(() => {
    const filePath = displayFiles[selectedIndex];
    if (!filePath) return;
    dismiss();
    openFile(filePath);
  }, [displayFiles, selectedIndex, dismiss, openFile]);

  const executeInPane = useCallback((direction: "left" | "right") => {
    const filePath = displayFiles[selectedIndex];
    if (!filePath) return;
    dismiss();
    splitPane(direction, true);
    setTimeout(() => openFile(filePath), 0);
  }, [displayFiles, selectedIndex, dismiss, openFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(displayFiles.length - 1, i + 1));
          break;
        case "Enter":
          e.preventDefault();
          executeSelected();
          break;
        case "ArrowLeft":
          e.preventDefault();
          executeInPane("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          executeInPane("right");
          break;
        case "Escape":
          e.preventDefault();
          dismiss();
          break;
      }
    },
    [displayFiles.length, executeSelected, executeInPane, dismiss]
  );

  if (!visible) return null;

  return (
    <OverlayWrapper>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15%]" onClick={dismiss}>
        <div
          className="w-[450px] flex flex-col rounded-xl border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <svg className="w-4 h-4 text-[var(--ctp-overlay1)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5a.75.75 0 0 1 .75.75v5l3.22 1.85a.75.75 0 1 1-.74 1.3L7.25 8.4V2.25A.75.75 0 0 1 8 1.5Z" />
              <path fillRule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" clipRule="evenodd" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recent files..."
              className="flex-1 bg-transparent text-[13px] text-[var(--ctp-text)] placeholder:text-[var(--ctp-overlay0)] outline-none"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--ctp-surface1)] text-[var(--ctp-text)]">
              Recent
            </span>
          </div>

          <div className="h-px bg-[var(--ctp-surface1)]" />

          {/* Results */}
          <div ref={listRef} className="max-h-[350px] overflow-y-auto py-1 px-1.5">
            {loading ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">Loading...</div>
            ) : displayFiles.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">
                {files.length === 0
                  ? "No recent files in this workspace"
                  : closedRecents.length === 0
                    ? "All recent files are currently open"
                    : "No matching files"}
              </div>
            ) : (
              displayFiles.map((filePath, index) => (
                <RecentFileRow
                  key={filePath}
                  filePath={filePath}
                  workspacePath={selectedWorkspacePath ?? ""}
                  isSelected={index === selectedIndex}
                  onClick={() => {
                    dismiss();
                    openFile(filePath);
                  }}
                  onHover={() => setSelectedIndex(index)}
                />
              ))
            )}
          </div>

          <div className="h-px bg-[var(--ctp-surface1)]" />

          {/* Footer hints */}
          <div className="flex items-center gap-4 px-3 py-1.5">
            <FooterHint keys="↑↓" label="navigate" />
            <FooterHint keys="⏎" label="open" />
            <FooterHint keys="←" label="open left" />
            <FooterHint keys="→" label="open right" />
            <FooterHint keys="esc" label="dismiss" />
          </div>
        </div>
      </div>
    </OverlayWrapper>
  );
}

function RecentFileRow({
  filePath,
  workspacePath,
  isSelected,
  onClick,
  onHover,
}: {
  filePath: string;
  workspacePath: string;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  const relative = workspacePath && filePath.startsWith(workspacePath)
    ? filePath.slice(workspacePath.length + 1)
    : filePath;
  const fileName = relative.split("/").pop() ?? relative;
  const dir = relative.slice(0, relative.length - fileName.length - 1);

  return (
    <div
      role="button"
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 cursor-pointer ${
        isSelected ? "bg-[var(--ctp-surface1)]" : ""
      }`}
    >
      <svg className="w-3.5 h-3.5 text-[var(--ctp-overlay1)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073H3.75Z" />
      </svg>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-medium text-[var(--ctp-text)] truncate">{fileName}</span>
        {dir && <span className="text-[11px] text-[var(--ctp-overlay1)] truncate">{dir}</span>}
      </div>
    </div>
  );
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-[var(--ctp-overlay0)]">
      <span className="font-medium">{keys}</span>
      <span>{label}</span>
    </div>
  );
}
