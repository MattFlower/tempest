import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";

export const rustfmt: FormatterProvider = {
  id: "rustfmt",
  displayName: "rustfmt",
  languages: ["rust"],
  async applies(_ctx: FormatContext): Promise<boolean> {
    return whichGlobal("rustfmt") !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("rustfmt");
    if (!bin) return { kind: "error", message: "rustfmt not on PATH" };
    // rustfmt reads stdin and writes to stdout when given --emit=stdout.
    // --edition is required for some stable rustfmt builds (otherwise the
    // tool prints a warning and falls back to 2015 syntax). 2021 is the
    // most common modern edition; rustfmt.toml in the project still wins.
    const raw = await spawnFormatter({
      bin,
      args: ["--emit=stdout", "--edition=2021"],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "rustfmt", ctx.content);
  },
  installHint() { return "Install rustfmt: rustup component add rustfmt"; },
};
