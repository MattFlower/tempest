// ============================================================
// Editor command builder — constructs shell commands for
// opening files in the user's configured editor.
// Supports terminal-based editors (nvim, vim, hx, nano, etc.)
// and GUI editors (code, zed, etc.).
// ============================================================

interface EditorDef {
  /** Build args for the editor binary. */
  args: (filePath: string, lineNumber?: number) => string[];
  /** Whether this editor runs inside a terminal (true) or launches a GUI window (false). */
  isTerminal: boolean;
}

const EDITORS: Record<string, EditorDef> = {
  nvim: {
    args: (f, l) => (l ? [`+${l}`, f] : [f]),
    isTerminal: true,
  },
  vim: {
    args: (f, l) => (l ? [`+${l}`, f] : [f]),
    isTerminal: true,
  },
  hx: {
    args: (f, l) => (l ? [`${f}:${l}`] : [f]),
    isTerminal: true,
  },
  nano: {
    args: (f, l) => (l ? [`+${l}`, f] : [f]),
    isTerminal: true,
  },
  micro: {
    args: (f, l) => (l ? [`+${l}`, f] : [f]),
    isTerminal: true,
  },
  emacs: {
    args: (f, l) => (l ? [`+${l}`, f] : [f]),
    isTerminal: true,
  },
  code: {
    args: (f, l) => (l ? ["--goto", `${f}:${l}`] : [f]),
    isTerminal: false,
  },
  zed: {
    args: (f, l) => (l ? [`${f}:${l}`] : [f]),
    isTerminal: false,
  },
};

/**
 * Build a shell command array to open a file in the given editor.
 * For terminal editors, wraps in a login shell with exec.
 * For GUI editors, launches directly.
 */
export function buildEditorCommand(
  editor: string,
  filePath: string,
  lineNumber?: number,
): { command: string[] } {
  const def = EDITORS[editor];

  if (def) {
    const args = def.args(filePath, lineNumber);
    if (def.isTerminal) {
      const escaped = args.map((a) => `'${a}'`).join(" ");
      return { command: ["/bin/zsh", "-lic", `exec ${editor} ${escaped}`] };
    }
    return { command: [editor, ...args] };
  }

  // Unknown editor — assume terminal-based, use vim-style +line syntax
  const args = lineNumber ? [`+${lineNumber}`, filePath] : [filePath];
  const escaped = args.map((a) => `'${a}'`).join(" ");
  return { command: ["/bin/zsh", "-lic", `exec ${editor} ${escaped}`] };
}
