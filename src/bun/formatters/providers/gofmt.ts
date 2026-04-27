import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";

export const gofmt: FormatterProvider = {
  id: "gofmt",
  displayName: "gofmt",
  languages: ["go"],
  async applies(_ctx: FormatContext): Promise<boolean> {
    return whichGlobal("gofmt") !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("gofmt");
    if (!bin) return { kind: "error", message: "gofmt not on PATH" };
    const raw = await spawnFormatter({
      bin,
      args: [],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "gofmt", ctx.content);
  },
  installHint() { return "Install Go: https://go.dev/dl/"; },
};
