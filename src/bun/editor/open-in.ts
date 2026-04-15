// ============================================================
// "Open In" app detection and launch.
// Detects installed editors and terminals on macOS and opens
// worktrees in them.
// ============================================================

import { accessSync } from "node:fs";
import { PathResolver } from "../config/path-resolver";

const pathResolver = new PathResolver();

export type AppCategory = "editor" | "terminal" | "file-manager";

export interface InstalledApp {
  id: string;
  name: string;
  category: AppCategory;
}

interface AppSpec {
  id: string;
  name: string;
  category: AppCategory;
  /** macOS .app bundle path(s) to check. */
  appPaths: string[];
  /** CLI binary names to check on PATH via a login shell. */
  cliBinaries: string[];
  /** Build the shell command to open a directory. */
  openCommand: (dir: string) => string[];
}

// Alphabetized by name within each category.
const APP_SPECS: AppSpec[] = [
  // --- Editors ---
  {
    id: "cursor",
    name: "Cursor",
    category: "editor",
    appPaths: ["/Applications/Cursor.app"],
    cliBinaries: ["cursor"],
    openCommand: (dir) => ["open", "-a", "Cursor", dir],
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    category: "editor",
    appPaths: [
      "/Applications/IntelliJ IDEA.app",
      "/Applications/IntelliJ IDEA CE.app",
      "/Applications/IntelliJ IDEA Ultimate.app",
    ],
    cliBinaries: ["idea"],
    openCommand: (dir) => ["open", "-a", "IntelliJ IDEA", dir],
  },
  {
    id: "neovim",
    name: "Neovim",
    category: "editor",
    appPaths: [],
    cliBinaries: ["nvim"],
    // Pass directory as a positional parameter to avoid shell interpolation.
    openCommand: (dir) => [
      "/bin/zsh",
      "-lic",
      'target_dir="$1"; cd "$target_dir" && exec nvim .',
      "_",
      dir,
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    category: "editor",
    appPaths: ["/Applications/Visual Studio Code.app"],
    cliBinaries: ["code"],
    openCommand: (dir) => ["open", "-a", "Visual Studio Code", dir],
  },
  {
    id: "xcode",
    name: "Xcode",
    category: "editor",
    appPaths: ["/Applications/Xcode.app"],
    cliBinaries: [],
    openCommand: (dir) => ["open", "-a", "Xcode", dir],
  },
  {
    id: "zed",
    name: "Zed",
    category: "editor",
    appPaths: ["/Applications/Zed.app"],
    cliBinaries: ["zed"],
    openCommand: (dir) => ["open", "-a", "Zed", dir],
  },

  // --- Terminals ---
  {
    id: "alacritty",
    name: "Alacritty",
    category: "terminal",
    appPaths: ["/Applications/Alacritty.app"],
    cliBinaries: ["alacritty"],
    openCommand: (dir) => ["/Applications/Alacritty.app/Contents/MacOS/alacritty", "--working-directory", dir],
  },
  {
    id: "apple-terminal",
    name: "Apple Terminal",
    category: "terminal",
    appPaths: ["/System/Applications/Utilities/Terminal.app"],
    cliBinaries: [],
    openCommand: (dir) => ["open", "-a", "Terminal", dir],
  },
  {
    id: "ghostty",
    name: "Ghostty",
    category: "terminal",
    appPaths: ["/Applications/Ghostty.app"],
    cliBinaries: ["ghostty"],
    openCommand: (dir) => ["open", "-na", "Ghostty.app", "--args", `--working-directory=${dir}`],
  },
  {
    id: "gnome-terminal",
    name: "GNOME Terminal",
    category: "terminal",
    appPaths: [],
    cliBinaries: ["gnome-terminal"],
    openCommand: (dir) => ["gnome-terminal", `--working-directory=${dir}`],
  },
  {
    id: "iterm2",
    name: "iTerm2",
    category: "terminal",
    appPaths: ["/Applications/iTerm.app"],
    cliBinaries: [],
    openCommand: (dir) => ["open", "-a", "iTerm", dir],
  },
  {
    id: "kitty",
    name: "Kitty",
    category: "terminal",
    appPaths: ["/Applications/kitty.app"],
    cliBinaries: ["kitty"],
    openCommand: (dir) => ["/Applications/kitty.app/Contents/MacOS/kitty", "-d", dir],
  },
  {
    id: "wezterm",
    name: "WezTerm",
    category: "terminal",
    appPaths: ["/Applications/WezTerm.app"],
    cliBinaries: ["wezterm"],
    openCommand: (dir) => ["/Applications/WezTerm.app/Contents/MacOS/wezterm", "start", "--cwd", dir],
  },

  // --- File Managers ---
  {
    id: "dolphin",
    name: "Dolphin",
    category: "file-manager",
    appPaths: [],
    cliBinaries: ["dolphin"],
    openCommand: (dir) => ["dolphin", dir],
  },
  {
    id: "explorer",
    name: "Explorer",
    category: "file-manager",
    appPaths: [],
    cliBinaries: ["explorer.exe"],
    openCommand: (dir) => ["explorer.exe", dir],
  },
  {
    id: "finder",
    name: "Finder",
    category: "file-manager",
    appPaths: ["/System/Library/CoreServices/Finder.app"],
    cliBinaries: [],
    openCommand: (dir) => ["open", dir],
  },
  {
    id: "nautilus",
    name: "Files (Nautilus)",
    category: "file-manager",
    appPaths: [],
    cliBinaries: ["nautilus"],
    openCommand: (dir) => ["nautilus", dir],
  },
];

function isAppInstalled(appPaths: string[]): boolean {
  for (const p of appPaths) {
    try {
      accessSync(p);
      return true;
    } catch { /* not found */ }
  }
  return false;
}

function isCLIAvailable(binaries: string[]): boolean {
  for (const bin of binaries) {
    try {
      pathResolver.resolve(bin);
      return true;
    } catch { /* not found */ }
  }
  return false;
}

let cachedEditors: InstalledApp[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Detect which supported apps are installed on the system.
 * Results are cached for 30 seconds and sorted alphabetically by name.
 */
export function getInstalledEditors(): InstalledApp[] {
  const now = Date.now();
  if (cachedEditors && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEditors;
  }

  const editors = APP_SPECS
    .filter((spec) => isAppInstalled(spec.appPaths) || isCLIAvailable(spec.cliBinaries))
    .map((s) => ({ id: s.id, name: s.name, category: s.category }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedEditors = editors;
  cacheTimestamp = now;
  return editors;
}

/**
 * Open a directory in the specified app.
 * For terminal-based editors (neovim), returns a command array to run in a terminal pane.
 * For GUI apps, spawns the process directly and returns null.
 */
export async function openInEditor(
  editorId: string,
  directory: string,
): Promise<{ terminalCommand: string[] | null }> {
  const spec = APP_SPECS.find((s) => s.id === editorId);
  if (!spec) throw new Error(`Unknown app: ${editorId}`);

  // Neovim is terminal-based — return command for the frontend to open in a terminal pane
  if (editorId === "neovim") {
    return { terminalCommand: spec.openCommand(directory) };
  }

  // GUI apps — spawn directly
  const cmd = spec.openCommand(directory);
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return { terminalCommand: null };
}
