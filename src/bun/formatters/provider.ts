// ============================================================
// FormatterProvider — the abstraction every formatting backend implements.
//
// Three backend categories cover everything we wire up in Phase 2:
//   - LSP-as-provider: ask the language server (only when its capabilities
//     announced documentFormatting / documentRangeFormatting).
//   - External CLI: spawn `prettier` / `gofmt` / `rustfmt` / etc. with
//     the buffer on stdin and read formatted output from stdout.
//   - (Phase 4) On-buffer rules from .editorconfig — not yet.
//
// Each provider answers two questions: "do I apply to this file?" and
// "format it." The registry runs `applies()` in priority order until one
// returns true, then runs `formatDocument` (or `formatRange`).
// ============================================================

import type { LspRange, LspTextEdit } from "../../shared/ipc-types";

/** Information supplied to every provider call. The same shape is used
 *  for `applies()` and for `formatDocument()` — `applies()` may need the
 *  language id and workspacePath to decide eligibility. */
export interface FormatContext {
  filePath: string;
  workspacePath?: string;
  languageId: string;
  content: string;
  options: { tabSize: number; insertSpaces: boolean };
}

/** A formatter's result. CLI tools that emit a whole buffer take the
 *  `fullText` shape; LSP returns a list of text edits directly. `noop`
 *  means "nothing to do" (file is already formatted); `error` is a
 *  failure the caller should surface to the user. */
export type FormatResult =
  | { kind: "fullText"; newText: string }
  | { kind: "edits"; edits: LspTextEdit[] }
  | { kind: "noop" }
  | { kind: "error"; message: string };

export interface FormatterProvider {
  /** Stable id for config + UI. */
  id: string;
  /** Human-readable label shown in pickers / footer / "Formatted with X". */
  displayName: string;
  /** Monaco language ids this provider can handle. The registry filters
   *  on this list before calling `applies()`. */
  languages: readonly string[];
  /** Does this provider apply to (filePath, workspacePath)? Should be
   *  cheap — the registry calls every provider's `applies()` to decide
   *  what to surface in the picker / "no formatter" message. */
  applies(ctx: FormatContext): Promise<boolean>;
  /** Format the whole document. Called when `applies()` returned true. */
  formatDocument(ctx: FormatContext): Promise<FormatResult>;
  /** Format a sub-range. Optional — when absent, range formatting falls
   *  back to whole-document formatting (or is unavailable, depending on
   *  caller). */
  formatRange?(ctx: FormatContext, range: LspRange): Promise<FormatResult>;
  /** Suggested install command shown when nothing applies for a file
   *  this provider's language list covers. Optional. */
  installHint?(): string;
}
