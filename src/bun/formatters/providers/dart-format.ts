import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";

export const dartFormat: FormatterProvider = {
  id: "dart-format",
  displayName: "dart format",
  languages: ["dart"],
  async applies(_ctx: FormatContext): Promise<boolean> {
    return whichGlobal("dart") !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("dart");
    if (!bin) return { kind: "error", message: "dart not on PATH" };
    // `dart format` reads stdin when the path arg is `-` and emits the
    // formatted result on stdout.
    const raw = await spawnFormatter({
      bin,
      args: ["format", "--output=show", "-"],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "dart format", ctx.content);
  },
  installHint() { return "Install Dart: https://dart.dev/get-dart"; },
};
