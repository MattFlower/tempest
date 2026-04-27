// ============================================================
// Resolve formatting config for a (filePath, workspacePath, languageId)
// triple by merging the four scopes the user can configure:
//
//   1. AppConfig.formatting                     (global default)
//   2. AppConfig.formatting.languages[lang]     (per-language global)
//   3. RepoSettings.formatting                  (repo-level override)
//   4. RepoSettings.formatting.languages[lang]  (per-language repo)
//
// Later scopes override earlier ones. Same idea for editorSaveActions
// (no per-language scope there — trim/final-newline are buffer-wide).
//
// The result is a single flat shape downstream code can consume
// without thinking about scope.
// ============================================================

import type {
  AppConfig,
  EditorSaveActionsConfig,
  FormattingConfig,
  LanguageFormattingConfig,
  RepoSettings,
} from "../../shared/ipc-types";

export interface ResolvedFormatting {
  formatOnSave: boolean;
  formatOnPaste: boolean;
  formatOnType: boolean;
  /** Provider id forced for this file. `null` = no override; the
   *  registry's resolution order picks. */
  forcedProvider: string | null;
  timeoutMs: number;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
}

export interface ResolveInput {
  config: AppConfig;
  repoSettings?: RepoSettings;
  languageId: string;
}

const DEFAULTS: ResolvedFormatting = {
  formatOnSave: false,
  formatOnPaste: false,
  formatOnType: false,
  forcedProvider: null,
  timeoutMs: 2000,
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
};

function applyFormatting(
  acc: ResolvedFormatting,
  fmt: FormattingConfig | undefined,
  langOnly: LanguageFormattingConfig | undefined,
): void {
  // Apply scope-level fields, then per-language overrides on top of
  // those. Caller decides which scope owns `fmt` (global vs repo).
  if (fmt) {
    if (fmt.formatOnSave !== undefined) acc.formatOnSave = fmt.formatOnSave;
    if (fmt.formatOnPaste !== undefined) acc.formatOnPaste = fmt.formatOnPaste;
    if (fmt.formatOnType !== undefined) acc.formatOnType = fmt.formatOnType;
    if (fmt.defaultFormatter !== undefined) acc.forcedProvider = fmt.defaultFormatter;
    if (fmt.timeoutMs !== undefined) acc.timeoutMs = fmt.timeoutMs;
  }
  if (langOnly) {
    if (langOnly.formatOnSave !== undefined) acc.formatOnSave = langOnly.formatOnSave;
    if (langOnly.defaultFormatter !== undefined) acc.forcedProvider = langOnly.defaultFormatter;
  }
}

function applySaveActions(
  acc: ResolvedFormatting,
  sa: EditorSaveActionsConfig | undefined,
): void {
  if (!sa) return;
  if (sa.trimTrailingWhitespace !== undefined) acc.trimTrailingWhitespace = sa.trimTrailingWhitespace;
  if (sa.insertFinalNewline !== undefined) acc.insertFinalNewline = sa.insertFinalNewline;
}

export function resolveFormatting(input: ResolveInput): ResolvedFormatting {
  const acc: ResolvedFormatting = { ...DEFAULTS };

  // 1+2: app-config global, then app-config per-language.
  applyFormatting(
    acc,
    input.config.formatting,
    input.config.formatting?.languages?.[input.languageId],
  );
  applySaveActions(acc, input.config.editorSaveActions);

  // 3+4: repo overrides, then repo per-language.
  if (input.repoSettings) {
    applyFormatting(
      acc,
      input.repoSettings.formatting,
      input.repoSettings.formatting?.languages?.[input.languageId],
    );
    applySaveActions(acc, input.repoSettings.editorSaveActions);
  }

  return acc;
}
