// Black is the de facto Python formatter. Gated on the project having
// a `[tool.black]` section in pyproject.toml — projects that don't
// configure Black explicitly might be using a different formatter, so
// running Black silently could fight with their setup.

import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";
import { findUpWithMarker } from "../find-up";

export const black: FormatterProvider = {
  id: "black",
  displayName: "Black",
  languages: ["python"],
  async applies(ctx: FormatContext): Promise<boolean> {
    if (ctx.languageId !== "python") return false;
    if (!whichGlobal("black")) return false;
    return findUpWithMarker(
      ctx.filePath,
      "pyproject.toml",
      ["[tool.black]"],
      ctx.workspacePath,
    ) !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("black");
    if (!bin) return { kind: "error", message: "black not on PATH" };
    // --quiet suppresses the "All done! ✨" status line that Black
    // otherwise writes to stderr; --stdin-filename lets Black find
    // the right pyproject.toml as if it were processing the file
    // in-place. `-` is the conventional stdin sentinel.
    const raw = await spawnFormatter({
      bin,
      args: ["--quiet", `--stdin-filename=${ctx.filePath}`, "-"],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "black", ctx.content);
  },
  installHint() { return "Install Black: pip install black"; },
};
