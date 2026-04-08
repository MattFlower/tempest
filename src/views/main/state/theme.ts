// ============================================================
// Theme manager — applies dark/light theme across CSS variables,
// xterm.js terminals, and Monaco editors.
// ============================================================

import { getAllTerminalInstances } from "./terminal-registry";

export type ThemeMode = "dark" | "light";

let currentTheme: ThemeMode = "dark";

// --- Terminal palettes (xterm.js requires hardcoded hex) ---

const darkTerminalTheme = {
  background: "#242424",
  foreground: "#ffffff",
  cursor: "#ffffff",
  selectionBackground: "#ffffff",
  selectionForeground: "#2e2e2e",
  black: "#1d1f21",
  red: "#cc6666",
  green: "#b5bd68",
  yellow: "#f0c674",
  blue: "#81a2be",
  magenta: "#b294bb",
  cyan: "#8abeb7",
  white: "#c5c8c6",
  brightBlack: "#666666",
  brightRed: "#d54e53",
  brightGreen: "#b9ca4a",
  brightYellow: "#e7c547",
  brightBlue: "#7aa6da",
  brightMagenta: "#c397d8",
  brightCyan: "#70c0b1",
  brightWhite: "#eaeaea",
};

const lightTerminalTheme = {
  background: "#f0f0f0",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  selectionBackground: "#1a6fdb44",
  selectionForeground: "#1a1a1a",
  black: "#1a1a1a",
  red: "#c5354b",
  green: "#2c9e2c",
  yellow: "#d4970b",
  blue: "#1a6fdb",
  magenta: "#8839ef",
  cyan: "#179299",
  white: "#dfdfdf",
  brightBlack: "#8c8c8c",
  brightRed: "#d20f39",
  brightGreen: "#40a02b",
  brightYellow: "#df8e1d",
  brightBlue: "#1e66f5",
  brightMagenta: "#7c3aed",
  brightCyan: "#0d9488",
  brightWhite: "#f0f0f0",
};

export function getCurrentTheme(): ThemeMode {
  return currentTheme;
}

export function getTerminalTheme(mode: ThemeMode) {
  return mode === "light" ? lightTerminalTheme : darkTerminalTheme;
}

export function applyTheme(mode: ThemeMode) {
  currentTheme = mode;

  // 1. CSS variables: set/remove data-theme attribute
  if (mode === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  // 2. Terminal instances: update all live terminals
  const terminalTheme = getTerminalTheme(mode);
  for (const [, instance] of getAllTerminalInstances()) {
    instance.terminal.options.theme = terminalTheme;
  }
}
