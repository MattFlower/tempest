import { useState, useEffect, useRef, useCallback } from "react";
import { PaneTabKind, EditorType, ViewMode } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { api } from "../../state/rpc-client";
import { fuzzyMatch } from "./fuzzy-match";
import {
  addTab,
  closeTab,
  splitPane,
  focusNextPane,
  focusPreviousPane,
  toggleMaximize,
  resetRatios,
} from "../../state/actions";
import { findPane } from "../../models/pane-node";

type PaletteMode = "commands" | "files";

interface PaletteCommand {
  id: string;
  label: string;
  shortcutHint?: string;
  canOpenAsPane: boolean;
  /** If true, executing this command keeps the palette open. */
  staysOpen?: boolean;
  action: () => void;
}

function isMonacoDefault(): boolean {
  return useStore.getState().config?.editor === "monaco";
}

function addTabToFocusedPane(kind: PaneTabKind, label: string, overrides?: Record<string, any>) {
  const { focusedPaneId } = useStore.getState();
  if (!focusedPaneId) return;

  const needsTerminalId =
    kind === PaneTabKind.Claude ||
    kind === PaneTabKind.Shell ||
    (kind === PaneTabKind.Editor &&
      overrides?.editorType !== EditorType.Monaco &&
      !(overrides?.editorType === undefined && isMonacoDefault()));

  const tab = createTab(kind, label, {
    ...(needsTerminalId ? { terminalId: crypto.randomUUID() } : {}),
    ...(kind === PaneTabKind.Browser ? { browserURL: "https://google.com" } : {}),
    ...overrides,
  });
  addTab(focusedPaneId, tab);
}

function useCommands(): PaletteCommand[] {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setViewMode = useStore((s) => s.setViewMode);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const setMode = (mode: ViewMode) => {
    if (selectedWorkspacePath) setViewMode(selectedWorkspacePath, mode);
  };

  const closeSelectedTab = () => {
    const state = useStore.getState();
    const { focusedPaneId, paneTrees, selectedWorkspacePath: wsPath } = state;
    if (!focusedPaneId || !wsPath) return;
    const tree = paneTrees[wsPath];
    if (!tree) return;
    const pane = findPane(tree, focusedPaneId);
    if (pane?.selectedTabId) closeTab(focusedPaneId, pane.selectedTabId);
  };

  return [
    // Tab commands
    { id: "new-claude", label: "Claude", shortcutHint: "⌘T", canOpenAsPane: true, action: () => addTabToFocusedPane(PaneTabKind.Claude, "Claude") },
    { id: "new-shell", label: "New Shell Tab", shortcutHint: "⌘⏎", canOpenAsPane: true, action: () => addTabToFocusedPane(PaneTabKind.Shell, "Shell") },
    { id: "new-browser", label: "Browser", shortcutHint: "⌘⇧B", canOpenAsPane: true, action: () => addTabToFocusedPane(PaneTabKind.Browser, "Browser") },
    { id: "history", label: "Chat History", shortcutHint: "⌘⇧H", canOpenAsPane: true, action: () => addTabToFocusedPane(PaneTabKind.HistoryViewer, "History") },
    { id: "pr-dashboard", label: "PR Review Dashboard", canOpenAsPane: true, action: () => addTabToFocusedPane(PaneTabKind.PRDashboard, "PR Reviews") },

    // Tab/pane actions
    { id: "close-tab", label: "Close Tab", shortcutHint: "⌘W", canOpenAsPane: false, action: closeSelectedTab },
    { id: "split-pane", label: "Split Pane", shortcutHint: "⌘D", canOpenAsPane: false, action: () => splitPane("right") },
    { id: "focus-next", label: "Focus Next Pane", shortcutHint: "⌘]", canOpenAsPane: false, action: focusNextPane },
    { id: "focus-prev", label: "Focus Previous Pane", shortcutHint: "⌘[", canOpenAsPane: false, action: focusPreviousPane },
    { id: "focus-left", label: "Focus Pane Left", shortcutHint: "⌘⌥←", canOpenAsPane: false, action: focusPreviousPane },
    { id: "focus-right", label: "Focus Pane Right", shortcutHint: "⌘⌥→", canOpenAsPane: false, action: focusNextPane },
    { id: "toggle-maximize", label: "Toggle Maximize Pane", shortcutHint: "⌘⇧⏎", canOpenAsPane: false, action: toggleMaximize },
    { id: "reset-ratios", label: "Reset Pane Sizes", shortcutHint: "⌘⇧=", canOpenAsPane: false, action: resetRatios },

    // View modes
    { id: "terminal-view", label: "Terminal View", shortcutHint: "⌘1", canOpenAsPane: false, action: () => setMode(ViewMode.Terminal) },
    { id: "diff-view", label: "Diff View", shortcutHint: "⌘2", canOpenAsPane: false, action: () => setMode(ViewMode.Diff) },
    { id: "dashboard-view", label: "Dashboard View", shortcutHint: "⌘3", canOpenAsPane: false, action: () => setMode(ViewMode.Dashboard) },

    // Repos
    { id: "add-repo", label: "Add Repository", canOpenAsPane: false, action: async () => {
      const result = await api.browseDirectory("~/");
      if (!result.path) return;
      await api.addRepo(result.path);
      const repos = await api.getRepos();
      useStore.getState().setRepos(repos);
      for (const repo of repos) {
        const ws = await api.getWorkspaces(repo.id);
        useStore.getState().setWorkspaces(repo.id, ws);
      }
    }},

    // App
    { id: "toggle-sidebar", label: "Toggle Sidebar", shortcutHint: "⌘\\", canOpenAsPane: false, action: toggleSidebar },
  ];
}

export function CommandPalette() {
  const visible = useStore((s) => s.commandPaletteVisible);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const openCommandPaletteFiles = useStore((s) => s.openCommandPaletteFiles);
  const commandPaletteInitialMode = useStore((s) => s.commandPaletteInitialMode);
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const [mode, setMode] = useState<PaletteMode>("commands");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Tracks editor type override from "Open with Neovim/Monaco" commands
  const pendingEditorTypeRef = useRef<EditorType | null>(null);

  const baseCommands = useCommands();

  // "Open with" commands — these stay open and switch to files mode
  const openWithCommands: PaletteCommand[] = [
    {
      id: "open-with-neovim",
      label: "Open with Neovim",
      canOpenAsPane: false,
      staysOpen: true,
      action: () => {
        pendingEditorTypeRef.current = EditorType.Neovim;
        setMode("files");
        setQuery("");
        setSelectedIndex(0);
      },
    },
    {
      id: "open-with-monaco",
      label: "Open with Monaco",
      canOpenAsPane: false,
      staysOpen: true,
      action: () => {
        pendingEditorTypeRef.current = EditorType.Monaco;
        setMode("files");
        setQuery("");
        setSelectedIndex(0);
      },
    },
  ];

  const commands = [...baseCommands, ...openWithCommands];

  // Filter commands
  const filteredCommands = query
    ? commands
        .map((cmd) => ({ cmd, match: fuzzyMatch(query, cmd.label) }))
        .filter((r) => r.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
    : commands.map((cmd) => ({ cmd, match: { indices: [] as number[], score: 0 } }));

  // Filter files
  const filteredFiles = query
    ? files.filter((f) => {
        const name = f.split("/").pop() ?? f;
        return fuzzyMatch(query, name) !== null;
      })
      .slice(0, 100)
    : files.slice(0, 100);

  const itemCount = mode === "commands" ? filteredCommands.length : filteredFiles.length;

  // Reset on open
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      setMode(commandPaletteInitialMode);
      pendingEditorTypeRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible, commandPaletteInitialMode]);

  // Load files when switching to file mode
  useEffect(() => {
    if (mode === "files" && selectedWorkspacePath) {
      setLoadingFiles(true);
      api.listFiles(selectedWorkspacePath).then((result: string[]) => {
        setFiles(result);
        setLoadingFiles(false);
      });
    }
  }, [mode, selectedWorkspacePath]);

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

  const dismiss = useCallback(() => {
    pendingEditorTypeRef.current = null;
    toggleCommandPalette();
  }, [toggleCommandPalette]);

  const openFileAsEditor = useCallback((filePath: string, overrides?: Record<string, any>) => {
    const editorType = pendingEditorTypeRef.current ?? undefined;
    const name = filePath.split("/").pop() ?? "File";

    // Markdown files open in the MarkdownViewer unless an explicit editor override was requested
    if (!editorType && /\.(?:md|markdown)$/i.test(name)) {
      addTabToFocusedPane(PaneTabKind.MarkdownViewer, name, { markdownFilePath: filePath });
    } else {
      addTabToFocusedPane(PaneTabKind.Editor, name, {
        editorFilePath: filePath,
        ...(editorType ? { editorType } : {}),
        ...overrides,
      });
    }
    pendingEditorTypeRef.current = null;
  }, []);

  const executeSelected = useCallback(() => {
    if (mode === "commands") {
      const item = filteredCommands[selectedIndex];
      if (item) {
        if (!item.cmd.staysOpen) dismiss();
        item.cmd.action();
      }
    } else if (mode === "files") {
      const filePath = filteredFiles[selectedIndex];
      if (filePath) {
        dismiss();
        openFileAsEditor(filePath);
      }
    }
  }, [mode, filteredCommands, filteredFiles, selectedIndex, dismiss, openFileAsEditor]);

  const executeInPane = useCallback((direction: "left" | "right") => {
    if (mode === "commands") {
      const item = filteredCommands[selectedIndex];
      if (item?.cmd.canOpenAsPane) {
        dismiss();
        // Split with an empty pane, then the action fills it
        splitPane(direction, true);
        setTimeout(() => item.cmd.action(), 0);
      }
    } else if (mode === "files") {
      const filePath = filteredFiles[selectedIndex];
      if (filePath) {
        dismiss();
        splitPane(direction, true);
        setTimeout(() => openFileAsEditor(filePath), 0);
      }
    }
  }, [mode, filteredCommands, filteredFiles, selectedIndex, dismiss, openFileAsEditor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(itemCount - 1, i + 1));
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
        case "Tab":
          e.preventDefault();
          pendingEditorTypeRef.current = null;
          setMode((m) => (m === "commands" ? "files" : "commands"));
          setQuery("");
          setSelectedIndex(0);
          break;
      }
    },
    [itemCount, executeSelected, dismiss]
  );

  // Global keyboard shortcut to open palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === "p") {
        e.preventDefault();
        toggleCommandPalette();
      } else if (e.metaKey && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        openCommandPaletteFiles();
      }
      if (e.metaKey && e.key === "\\") {
        e.preventDefault();
        useStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandPalette, openCommandPaletteFiles]);

  if (!visible) return null;

  // Build mode label for files mode when an editor override is active
  const filesLabel = pendingEditorTypeRef.current === EditorType.Neovim
    ? "Files (Neovim)"
    : pendingEditorTypeRef.current === EditorType.Monaco
      ? "Files (Monaco)"
      : "Files";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15%]" onClick={dismiss}>
      <div
        className="w-[450px] flex flex-col rounded-xl border border-[var(--ctp-surface1)] bg-[var(--ctp-surface0)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <svg className="w-4 h-4 text-[var(--ctp-overlay1)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" clipRule="evenodd" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "commands" ? "Search commands..." : "Search files..."}
            className="flex-1 bg-transparent text-[13px] text-[var(--ctp-text)] placeholder:text-[var(--ctp-overlay0)] outline-none"
            autoFocus
          />
          {/* Mode tabs */}
          <div className="flex gap-0.5 text-[10px]">
            <button
              onClick={() => { pendingEditorTypeRef.current = null; setMode("commands"); setQuery(""); setSelectedIndex(0); }}
              className={`px-2 py-0.5 rounded ${mode === "commands" ? "bg-[var(--ctp-surface1)] text-[var(--ctp-text)]" : "text-[var(--ctp-overlay0)]"}`}
            >
              Commands
            </button>
            <button
              onClick={() => { setMode("files"); setQuery(""); setSelectedIndex(0); }}
              className={`px-2 py-0.5 rounded ${mode === "files" ? "bg-[var(--ctp-surface1)] text-[var(--ctp-text)]" : "text-[var(--ctp-overlay0)]"}`}
            >
              {filesLabel}
            </button>
          </div>
        </div>

        <div className="h-px bg-[var(--ctp-surface1)]" />

        {/* Results */}
        <div ref={listRef} className="max-h-[350px] overflow-y-auto py-1 px-1.5">
          {mode === "commands" ? (
            filteredCommands.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">No matching commands</div>
            ) : (
              filteredCommands.map((item, index) => (
                <CommandRow
                  key={item.cmd.id}
                  command={item.cmd}
                  matchIndices={item.match?.indices ?? []}
                  isSelected={index === selectedIndex}
                  onClick={() => { if (!item.cmd.staysOpen) dismiss(); item.cmd.action(); }}
                  onHover={() => setSelectedIndex(index)}
                />
              ))
            )
          ) : loadingFiles ? (
            <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">Loading files...</div>
          ) : filteredFiles.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--ctp-overlay0)]">No files found</div>
          ) : (
            filteredFiles.map((filePath, index) => (
              <FileRow
                key={filePath}
                filePath={filePath}
                workspacePath={selectedWorkspacePath ?? ""}
                isSelected={index === selectedIndex}
                onClick={() => { dismiss(); openFileAsEditor(filePath); }}
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
          <FooterHint keys="Tab" label="switch mode" />
          <FooterHint keys="esc" label="dismiss" />
        </div>
      </div>
    </div>
  );
}

function CommandRow({
  command,
  matchIndices,
  isSelected,
  onClick,
  onHover,
}: {
  command: PaletteCommand;
  matchIndices: number[];
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  const indexSet = new Set(matchIndices);

  return (
    <div
      role="button"
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer ${
        isSelected ? "bg-[var(--ctp-surface1)]" : ""
      }`}
    >
      <span className="text-[13px] flex-1">
        {Array.from(command.label).map((char, i) => (
          <span
            key={i}
            className={indexSet.has(i) ? "font-bold text-[var(--ctp-text)]" : "text-[var(--ctp-subtext0)]"}
          >
            {char}
          </span>
        ))}
      </span>
      {command.canOpenAsPane && (
        <span className="text-[11px] text-[var(--ctp-overlay0)]">⇄</span>
      )}
      {command.shortcutHint && (
        <span className="text-[11px] text-[var(--ctp-overlay0)] bg-[var(--ctp-surface0)] px-1.5 py-0.5 rounded">
          {command.shortcutHint}
        </span>
      )}
    </div>
  );
}

function FileRow({
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
  const relative = filePath.startsWith(workspacePath)
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
