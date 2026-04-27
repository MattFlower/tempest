// Ruff is increasingly the default Python formatter. Gated on the
// project having a `[tool.ruff]` section in pyproject.toml or a
// `ruff.toml` / `.ruff.toml` upward from the file.

import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";
import { findUp, findUpWithMarker } from "../find-up";

export const ruff: FormatterProvider = {
  id: "ruff",
  displayName: "Ruff",
  languages: ["python"],
  async applies(ctx: FormatContext): Promise<boolean> {
    if (ctx.languageId !== "python") return false;
    if (!whichGlobal("ruff")) return false;
    if (findUp(ctx.filePath, ["ruff.toml", ".ruff.toml"], ctx.workspacePath)) return true;
    return findUpWithMarker(
      ctx.filePath,
      "pyproject.toml",
      ["[tool.ruff]", "[tool.ruff."],
      ctx.workspacePath,
    ) !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("ruff");
    if (!bin) return { kind: "error", message: "ruff not on PATH" };
    const raw = await spawnFormatter({
      bin,
      args: ["format", `--stdin-filename=${ctx.filePath}`, "-"],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "ruff format", ctx.content);
  },
  installHint() { return "Install Ruff: pip install ruff (or uv tool install ruff)"; },
};
