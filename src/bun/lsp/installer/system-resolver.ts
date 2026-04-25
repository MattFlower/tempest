// ============================================================
// System-bucket resolver.
//
// For servers we don't ship ourselves (e.g. sourcekit-lsp from Xcode),
// resolve the binary by searching the user's PATH. No install — if the
// binary isn't there, we surface a clear error and the user knows to
// install it (or the recipe gets moved to a different bucket).
//
// Phase 2 doesn't actually use this yet — the npm bucket covers our
// initial language list — but the resolver is wired so adding a system
// recipe in the future is a one-line registration.
// ============================================================

import type { ServerRecipe, SystemInstaller } from "../recipes";
import type { InstallerResult } from "./npm-installer";

export class SystemResolver {
  async resolve(recipe: ServerRecipe): Promise<InstallerResult> {
    if (recipe.installer.kind !== "system") {
      throw new Error(`SystemResolver can't resolve ${recipe.installer.kind} installer`);
    }
    const system = recipe.installer;
    const binaryPath = await whichBinary(system.binary);
    if (!binaryPath) {
      throw new Error(
        `${recipe.name} requires ${system.binary} on PATH; not found.`,
      );
    }
    return { binaryPath };
  }
}

async function whichBinary(binary: string): Promise<string | null> {
  const proc = Bun.spawn(["/usr/bin/env", "which", binary], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || !out) return null;
  // `which` may return multiple lines if the binary appears more than
  // once on PATH; we use the first hit, matching shell behaviour.
  return out.split("\n")[0]?.trim() ?? null;
}
