// ============================================================
// Prettier — the dominant formatter for the JavaScript / TypeScript /
// CSS / HTML / Markdown / YAML / GraphQL stack.
//
// Project-config-gated: applies only when one of the standard Prettier
// config files is found walking up from the buffer's directory. This
// matches what the VS Code Prettier extension does, and avoids running
// Prettier on every TS file in projects that aren't using it.
//
// Binary lookup prefers <workspacePath>/node_modules/.bin/prettier so
// the project's pinned version wins over a globally-installed one.
// ============================================================

import { readFileSync } from "node:fs";
import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { resolvePreferProject } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";
import { findUp } from "../find-up";

// Files whose mere presence configures Prettier.
const CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.ts",
  ".prettierrc.mts",
  ".prettierrc.cts",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.mts",
  "prettier.config.cts",
];

// Languages Prettier handles natively. Plugin-only formats (Java, PHP,
// XML, etc.) are not listed — the user can still opt in via per-language
// defaultFormatter once Phase 3 ships that config knob.
const SUPPORTED_LANGUAGES = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "json",
  "jsonc",
  "json5",
  "html",
  "css",
  "scss",
  "less",
  "markdown",
  "yaml",
  "graphql",
  "vue",
  "handlebars",
];

function packageJsonHasPrettier(workspacePath: string | undefined, fromPath: string): string | null {
  // Walk up from the file's dir looking for a package.json with a
  // `prettier` key. Prettier itself walks up from the file, but we
  // stop at workspacePath to avoid surprising behavior in monorepos.
  const pkgPath = findUp(fromPath, ["package.json"], workspacePath);
  if (!pkgPath) return null;
  try {
    const buf = readFileSync(pkgPath);
    const text = buf.toString("utf8");
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && "prettier" in obj) return pkgPath;
  } catch {
    // malformed package.json — pretend we didn't see it
  }
  return null;
}

function findPrettierConfig(ctx: FormatContext): string | null {
  const direct = findUp(ctx.filePath, CONFIG_FILES, ctx.workspacePath);
  if (direct) return direct;
  return packageJsonHasPrettier(ctx.workspacePath, ctx.filePath);
}

export const prettier: FormatterProvider = {
  id: "prettier",
  displayName: "Prettier",
  languages: SUPPORTED_LANGUAGES,
  async applies(ctx: FormatContext): Promise<boolean> {
    if (!SUPPORTED_LANGUAGES.includes(ctx.languageId)) return false;
    const bin = resolvePreferProject(ctx.workspacePath, "prettier");
    if (!bin) return false;
    return findPrettierConfig(ctx) !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = resolvePreferProject(ctx.workspacePath, "prettier");
    if (!bin) return { kind: "error", message: "prettier not found in node_modules/.bin or PATH" };
    // --stdin-filepath lets Prettier infer the parser from the file's
    // extension and resolve config relative to the file's location,
    // which matters in monorepos with per-package .prettierrc files.
    const raw = await spawnFormatter({
      bin,
      args: ["--stdin-filepath", ctx.filePath],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "prettier", ctx.content);
  },
  installHint() {
    return "Install Prettier in your project: npm install --save-dev prettier (or globally: npm install -g prettier)";
  },
};

// Re-export so tests can poke at config detection without spawning.
export const _internal = { findPrettierConfig, CONFIG_FILES, SUPPORTED_LANGUAGES };
