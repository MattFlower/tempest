import type { FormatContext, FormatResult, FormatterProvider } from "../provider";
import { whichGlobal } from "../path-resolver";
import { spawnFormatter, spawnRawToFormatResult } from "../spawn-format";

export const terraformFmt: FormatterProvider = {
  id: "terraform-fmt",
  displayName: "terraform fmt",
  languages: ["hcl", "terraform"],
  async applies(_ctx: FormatContext): Promise<boolean> {
    return whichGlobal("terraform") !== null;
  },
  async formatDocument(ctx: FormatContext): Promise<FormatResult> {
    const bin = whichGlobal("terraform");
    if (!bin) return { kind: "error", message: "terraform not on PATH" };
    // `terraform fmt -` reads stdin and emits formatted HCL on stdout.
    const raw = await spawnFormatter({
      bin,
      args: ["fmt", "-"],
      cwd: ctx.workspacePath,
      stdin: ctx.content,
    });
    return spawnRawToFormatResult(raw, "terraform fmt", ctx.content);
  },
  installHint() { return "Install Terraform: https://developer.hashicorp.com/terraform/install"; },
};
