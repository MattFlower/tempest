// Config-gated: applies only when a `.clang-format` (or `_clang-format`)
// is found upward from the file. Without one, clang-format would pick
// LLVM defaults — almost never what the user wants — so we'd rather fall
// through to "no formatter" and let them opt in by adding the config.

import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";
import { findUp } from "../find-up";

const SUPPORTED_LANGUAGES = ["c", "cpp", "objective-c", "objective-cpp", "cuda"];

export const clangFormat: FormatterProvider = {
  id: "clang-format",
  displayName: "clang-format",
  languages: SUPPORTED_LANGUAGES,
  async applies(ctx: FormatContext): Promise<boolean> {
    if (!SUPPORTED_LANGUAGES.includes(ctx.languageId)) return false;
    if (!whichGlobal("clang-format")) return false;
    return findUp(ctx.filePath, [".clang-format", "_clang-format"], ctx.workspacePath) !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("clang-format");
    if (!bin) return { kind: "error", message: "clang-format not on PATH" };
    const raw = await spawnFormatter({
      bin,
      args: [`--assume-filename=${ctx.filePath}`],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "clang-format", ctx.content);
  },
  installHint() { return "Install clang-format: brew install clang-format"; },
};
