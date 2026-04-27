// Verifies the four-scope merge order for FormattingConfig:
// app-global → app-per-language → repo-global → repo-per-language.

import { describe, it, expect } from "bun:test";
import type { AppConfig, RepoSettings } from "../../shared/ipc-types";
import { resolveFormatting } from "./config-resolver";

const baseConfig: AppConfig = {
  workspaceRoot: "/tmp",
  claudeArgs: [],
};

describe("resolveFormatting merge order", () => {
  it("returns defaults when no config or repo settings supply anything", () => {
    const r = resolveFormatting({ config: baseConfig, languageId: "typescript" });
    expect(r.formatOnSave).toBe(false);
    expect(r.forcedProvider).toBeNull();
    expect(r.timeoutMs).toBe(2000);
    expect(r.trimTrailingWhitespace).toBe(false);
  });

  it("app-global formatOnSave is honored", () => {
    const r = resolveFormatting({
      config: { ...baseConfig, formatting: { formatOnSave: true } },
      languageId: "typescript",
    });
    expect(r.formatOnSave).toBe(true);
  });

  it("app-per-language overrides app-global formatOnSave", () => {
    const r = resolveFormatting({
      config: {
        ...baseConfig,
        formatting: {
          formatOnSave: true,
          languages: { typescript: { formatOnSave: false } },
        },
      },
      languageId: "typescript",
    });
    expect(r.formatOnSave).toBe(false);
  });

  it("app-per-language defaultFormatter wins over app-global defaultFormatter", () => {
    const r = resolveFormatting({
      config: {
        ...baseConfig,
        formatting: {
          defaultFormatter: "lsp",
          languages: { typescript: { defaultFormatter: "prettier" } },
        },
      },
      languageId: "typescript",
    });
    expect(r.forcedProvider).toBe("prettier");
  });

  it("repo-global overrides app-global", () => {
    const repo: RepoSettings = {
      prepareScript: "",
      archiveScript: "",
      formatting: { formatOnSave: false },
    };
    const r = resolveFormatting({
      config: { ...baseConfig, formatting: { formatOnSave: true } },
      repoSettings: repo,
      languageId: "typescript",
    });
    expect(r.formatOnSave).toBe(false);
  });

  it("repo-per-language is the final word", () => {
    const repo: RepoSettings = {
      prepareScript: "",
      archiveScript: "",
      formatting: {
        formatOnSave: false,
        defaultFormatter: "lsp",
        languages: { python: { defaultFormatter: "ruff", formatOnSave: true } },
      },
    };
    const r = resolveFormatting({
      config: {
        ...baseConfig,
        formatting: {
          formatOnSave: true,
          defaultFormatter: "prettier",
          languages: { python: { defaultFormatter: "black" } },
        },
      },
      repoSettings: repo,
      languageId: "python",
    });
    expect(r.formatOnSave).toBe(true);    // from repo-per-language
    expect(r.forcedProvider).toBe("ruff"); // from repo-per-language
  });

  it("editorSaveActions merges across scopes; repo wins", () => {
    const repo: RepoSettings = {
      prepareScript: "",
      archiveScript: "",
      editorSaveActions: { trimTrailingWhitespace: false },
    };
    const r = resolveFormatting({
      config: {
        ...baseConfig,
        editorSaveActions: { trimTrailingWhitespace: true, insertFinalNewline: true },
      },
      repoSettings: repo,
      languageId: "typescript",
    });
    expect(r.trimTrailingWhitespace).toBe(false); // repo overrides
    expect(r.insertFinalNewline).toBe(true);     // app-global retained
  });

  it("non-matching language ignores per-language override", () => {
    const r = resolveFormatting({
      config: {
        ...baseConfig,
        formatting: {
          defaultFormatter: "prettier",
          languages: { python: { defaultFormatter: "ruff" } },
        },
      },
      languageId: "typescript",
    });
    expect(r.forcedProvider).toBe("prettier");
  });
});
