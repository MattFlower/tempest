import { describe, it, expect } from "bun:test";
import { defaultConfig, normalizeConfig, normalizeRepoPaths } from "./app-config";
import { PaneTabKind } from "../../shared/ipc-types";

describe("normalizeConfig", () => {
  it("falls back to defaults when required fields are invalid", () => {
    const normalized = normalizeConfig({
      workspaceRoot: 123,
      claudeArgs: null,
    });

    expect(normalized).toEqual(defaultConfig());
  });

  it("keeps valid values and drops invalid optional values", () => {
    const normalized = normalizeConfig({
      workspaceRoot: "/tmp/workspaces",
      claudeArgs: ["--foo"],
      jjPath: "/opt/homebrew/bin/jj",
      piArgs: ["--session", "abc"],
      theme: "light",
      monacoVimMode: true,
      httpServer: {
        enabled: true,
        port: 8080,
        hostname: "127.0.0.1",
        token: "secret",
      },
      mcpTools: {
        showWebpage: true,
      },
      httpAllowTerminalConnect: true,
      httpAllowTerminalWrite: false,
      editor: "nvim",
      // Invalid optional values should be ignored.
      gitPath: 123,
      piPath: null,
      httpDefaultPlanMode: "yes",
    });

    expect(normalized.workspaceRoot).toBe("/tmp/workspaces");
    expect(normalized.claudeArgs).toEqual(["--foo"]);
    expect(normalized.jjPath).toBe("/opt/homebrew/bin/jj");
    expect(normalized.piArgs).toEqual(["--session", "abc"]);
    expect(normalized.theme).toBe("light");
    expect(normalized.monacoVimMode).toBe(true);
    expect(normalized.httpServer).toEqual({
      enabled: true,
      port: 8080,
      hostname: "127.0.0.1",
      token: "secret",
    });
    expect(normalized.mcpTools).toEqual({ showWebpage: true });
    expect(normalized.httpAllowTerminalConnect).toBe(true);
    expect(normalized.httpAllowTerminalWrite).toBe(false);
    expect(normalized.editor).toBe("nvim");
    expect(normalized.gitPath).toBeUndefined();
    expect(normalized.piPath).toBeUndefined();
    expect(normalized.httpDefaultPlanMode).toBeUndefined();
  });

  it("preserves valid default pane kinds and drops invalid values", () => {
    expect(normalizeConfig({ defaultPaneKind: PaneTabKind.Codex }).defaultPaneKind)
      .toBe(PaneTabKind.Codex);
    expect(normalizeConfig({ defaultPaneKind: "editor" }).defaultPaneKind)
      .toBe(defaultConfig().defaultPaneKind);
  });
});

describe("normalizeConfig — formatting", () => {
  it("preserves a well-formed formatting block", () => {
    const normalized = normalizeConfig({
      workspaceRoot: "/tmp",
      claudeArgs: [],
      formatting: {
        formatOnSave: true,
        defaultFormatter: "prettier",
        timeoutMs: 4000,
        languages: { python: { defaultFormatter: "ruff" } },
      },
    });
    expect(normalized.formatting).toEqual({
      formatOnSave: true,
      defaultFormatter: "prettier",
      timeoutMs: 4000,
      languages: { python: { defaultFormatter: "ruff" } },
    });
  });

  it("drops malformed fields and empty language entries", () => {
    const normalized = normalizeConfig({
      workspaceRoot: "/tmp",
      claudeArgs: [],
      formatting: {
        formatOnSave: "yes",          // wrong type → dropped
        timeoutMs: -1,                // non-positive → dropped
        defaultFormatter: "",         // empty string → dropped
        languages: {
          typescript: { formatOnSave: 5 }, // wrong type → entry empty → dropped
          python: { defaultFormatter: "ruff" },
        },
      },
    });
    expect(normalized.formatting).toEqual({
      languages: { python: { defaultFormatter: "ruff" } },
    });
  });

  it("returns undefined when nothing valid is present", () => {
    const normalized = normalizeConfig({
      workspaceRoot: "/tmp",
      claudeArgs: [],
      formatting: { junk: 123 },
    });
    expect(normalized.formatting).toBeUndefined();
  });

  it("normalizes editorSaveActions independently", () => {
    const normalized = normalizeConfig({
      workspaceRoot: "/tmp",
      claudeArgs: [],
      editorSaveActions: { trimTrailingWhitespace: true, insertFinalNewline: "x" },
    });
    expect(normalized.editorSaveActions).toEqual({ trimTrailingWhitespace: true });
  });
});

describe("normalizeRepoPaths", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeRepoPaths({})).toEqual([]);
  });

  it("keeps only string paths", () => {
    expect(normalizeRepoPaths(["/repo/a", 123, null, "/repo/b"])).toEqual([
      "/repo/a",
      "/repo/b",
    ]);
  });
});
