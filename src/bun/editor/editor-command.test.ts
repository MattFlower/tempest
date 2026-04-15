// ============================================================
// Unit tests for the editor command builder.
// ============================================================

import { describe, test, expect } from "bun:test";
import { buildEditorCommand } from "./editor-command";

function terminalCommand(editor: string, ...args: string[]) {
  return [
    "/bin/zsh",
    "-lic",
    'editor="$1"; shift; exec "$editor" "$@"',
    "_",
    editor,
    ...args,
  ];
}

describe("buildEditorCommand", () => {
  describe("nvim", () => {
    test("opens file without line number", () => {
      const result = buildEditorCommand("nvim", "/path/to/file.ts");
      expect(result.command).toEqual(terminalCommand("nvim", "/path/to/file.ts"));
    });

    test("opens file at specific line", () => {
      const result = buildEditorCommand("nvim", "/path/to/file.ts", 42);
      expect(result.command).toEqual(terminalCommand("nvim", "+42", "/path/to/file.ts"));
    });

    test("handles single quotes in file paths safely", () => {
      const result = buildEditorCommand("nvim", "/tmp/O'Brien.ts");
      expect(result.command).toEqual(terminalCommand("nvim", "/tmp/O'Brien.ts"));
    });
  });

  describe("vim", () => {
    test("uses +line syntax like nvim", () => {
      const result = buildEditorCommand("vim", "/file.ts", 10);
      expect(result.command).toEqual(terminalCommand("vim", "+10", "/file.ts"));
    });
  });

  describe("hx (helix)", () => {
    test("uses file:line syntax", () => {
      const result = buildEditorCommand("hx", "/file.ts", 10);
      expect(result.command).toEqual(terminalCommand("hx", "/file.ts:10"));
    });

    test("opens file without line number", () => {
      const result = buildEditorCommand("hx", "/file.ts");
      expect(result.command).toEqual(terminalCommand("hx", "/file.ts"));
    });
  });

  describe("nano", () => {
    test("uses +line syntax", () => {
      const result = buildEditorCommand("nano", "/file.ts", 5);
      expect(result.command).toEqual(terminalCommand("nano", "+5", "/file.ts"));
    });
  });

  describe("code (VS Code)", () => {
    test("uses --goto flag for GUI editor", () => {
      const result = buildEditorCommand("code", "/file.ts", 10);
      expect(result.command).toEqual(["code", "--goto", "/file.ts:10"]);
    });

    test("opens file without line number", () => {
      const result = buildEditorCommand("code", "/file.ts");
      expect(result.command).toEqual(["code", "/file.ts"]);
    });
  });

  describe("zed", () => {
    test("uses file:line syntax for GUI editor", () => {
      const result = buildEditorCommand("zed", "/file.ts", 10);
      expect(result.command).toEqual(["zed", "/file.ts:10"]);
    });
  });

  describe("unknown editor", () => {
    test("falls back to terminal-based with +line syntax", () => {
      const result = buildEditorCommand("my-editor", "/file.ts", 10);
      expect(result.command).toEqual(terminalCommand("my-editor", "+10", "/file.ts"));
    });

    test("falls back without line number", () => {
      const result = buildEditorCommand("my-editor", "/file.ts");
      expect(result.command).toEqual(terminalCommand("my-editor", "/file.ts"));
    });
  });
});
