import {
  DEFAULT_WORKSPACE_PANE_KIND,
  DEFAULT_WORKSPACE_PANE_KINDS,
  PaneTabKind,
  type DefaultWorkspacePaneKind,
} from "../../../shared/ipc-types";
import {
  createLeaf,
  createPane,
  createTab,
  type PaneNode,
  type PaneTab,
} from "./pane-node";

export interface DefaultPaneOption {
  kind: DefaultWorkspacePaneKind;
  label: string;
  description: string;
  tabLabel: string;
}

export const DEFAULT_PANE_OPTIONS: readonly DefaultPaneOption[] = [
  {
    kind: PaneTabKind.Claude,
    label: "Claude",
    description: "Start Claude Code in the workspace.",
    tabLabel: "Claude",
  },
  {
    kind: PaneTabKind.Pi,
    label: "Pi",
    description: "Start Pi in the workspace.",
    tabLabel: "Pi",
  },
  {
    kind: PaneTabKind.Codex,
    label: "Codex",
    description: "Start Codex in the workspace.",
    tabLabel: "Codex",
  },
  {
    kind: PaneTabKind.Shell,
    label: "Terminal",
    description: "Start a regular shell terminal.",
    tabLabel: "Shell",
  },
  {
    kind: PaneTabKind.Browser,
    label: "Browser",
    description: "Open a browser pane.",
    tabLabel: "Browser",
  },
  {
    kind: PaneTabKind.HistoryViewer,
    label: "Chat History",
    description: "Open the agent history viewer.",
    tabLabel: "History",
  },
  {
    kind: PaneTabKind.PRDashboard,
    label: "PR Reviews",
    description: "Open the pull request review dashboard.",
    tabLabel: "PR Reviews",
  },
  {
    kind: PaneTabKind.KeymapHelp,
    label: "Keymap",
    description: "Open the keymap reference.",
    tabLabel: "Keymap",
  },
];

export function isDefaultWorkspacePaneKind(
  kind: unknown,
): kind is DefaultWorkspacePaneKind {
  return (
    typeof kind === "string" &&
    (DEFAULT_WORKSPACE_PANE_KINDS as readonly string[]).includes(kind)
  );
}

export function getDefaultPaneOption(kind: unknown): DefaultPaneOption {
  const normalized = isDefaultWorkspacePaneKind(kind)
    ? kind
    : DEFAULT_WORKSPACE_PANE_KIND;
  return DEFAULT_PANE_OPTIONS.find((option) => option.kind === normalized) ??
    DEFAULT_PANE_OPTIONS[0]!;
}

export function createDefaultWorkspaceTab(kind: unknown): PaneTab {
  const option = getDefaultPaneOption(kind);
  const needsTerminalId =
    option.kind === PaneTabKind.Claude ||
    option.kind === PaneTabKind.Pi ||
    option.kind === PaneTabKind.Codex ||
    option.kind === PaneTabKind.Shell;

  return createTab(option.kind, option.tabLabel, {
    ...(needsTerminalId ? { terminalId: crypto.randomUUID() } : {}),
    ...(option.kind === PaneTabKind.Browser ? { browserURL: "https://google.com" } : {}),
  });
}

export function createDefaultWorkspacePaneTree(kind: unknown): {
  tree: PaneNode;
  paneId: string;
} {
  const tab = createDefaultWorkspaceTab(kind);
  const pane = createPane(tab);
  return {
    tree: createLeaf(pane),
    paneId: pane.id,
  };
}
