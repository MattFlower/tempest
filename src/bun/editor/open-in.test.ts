import { describe, expect, test } from "bun:test";
import { openInEditor } from "./open-in";

describe("openInEditor", () => {
  test("returns a terminal command for neovim without interpolating directory", async () => {
    const dir = "/tmp/O'Brien";
    const result = await openInEditor("neovim", dir);

    expect(result.terminalCommand).toEqual([
      "/bin/zsh",
      "-lic",
      'target_dir="$1"; cd "$target_dir" && exec nvim .',
      "_",
      dir,
    ]);
  });

  test("throws for unknown app ids", async () => {
    expect(openInEditor("missing-app", "/tmp")).rejects.toThrow("Unknown app: missing-app");
  });
});
