import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";

export const shfmt: FormatterProvider = {
  id: "shfmt",
  displayName: "shfmt",
  languages: ["shell", "shellscript", "bash"],
  async applies(_ctx: FormatContext): Promise<boolean> {
    return whichGlobal("shfmt") !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("shfmt");
    if (!bin) return { kind: "error", message: "shfmt not on PATH" };
    const args: string[] = [];
    // shfmt honors -i (indent) when explicitly set; map our editor options.
    args.push("-i", String(ctx.options.insertSpaces ? ctx.options.tabSize : 0));
    const raw = await spawnFormatter({
      bin,
      args,
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "shfmt", ctx.content);
  },
  installHint() { return "Install shfmt: brew install shfmt (or go install mvdan.cc/sh/v3/cmd/shfmt@latest)"; },
};
