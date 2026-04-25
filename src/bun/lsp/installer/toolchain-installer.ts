// ============================================================
// Toolchain bucket installer.
//
// Some servers ship as part of a language's own toolchain (e.g. gopls is
// installed via `go install`). Tempest uses the toolchain to build the
// server into our managed install dir, but we don't bundle the toolchain
// itself — if the user doesn't have Go (or Java, or Ruby), we surface a
// clear error pointing them at the install instructions.
//
// Env vars in the recipe support a `$LSP_INSTALL_DIR` token that's
// substituted with the absolute path at install time. This lets recipes
// declaratively set things like GOBIN without hardcoding paths.
// ============================================================

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { LSP_INSTALL_DIR } from "../../config/paths";
import { ManifestStore } from "./manifest";
import { runProc } from "./proc";
import type { ServerRecipe, ToolchainInstaller as ToolchainSpec } from "../recipes";
import type { InstallerResult, InstallProgress } from "./npm-installer";

export class ToolchainInstaller {
  private inflight = new Map<string, Promise<void>>();
  private manifest = new ManifestStore();

  async resolve(
    recipe: ServerRecipe,
    onProgress?: InstallProgress,
  ): Promise<InstallerResult> {
    if (recipe.installer.kind !== "toolchain") {
      throw new Error(
        `ToolchainInstaller can't resolve ${recipe.installer.kind} installer`,
      );
    }
    const tc = recipe.installer;
    const binaryPath = join(LSP_INSTALL_DIR, tc.binaryRelative);

    // Verify the toolchain binary itself is on PATH. Doing this *before*
    // the manifest fast-path means we surface a clear "install Go"
    // message even if a stale binary happens to exist from a previous
    // install — a missing toolchain is a hard config problem and we'd
    // rather flag it than silently use a possibly-broken artifact.
    const toolchainPath = await whichBinary(tc.toolchain);
    if (!toolchainPath) {
      const hint = tc.toolchainHint ? ` ${tc.toolchainHint}` : "";
      throw new Error(
        `${recipe.name} requires '${tc.toolchain}' on PATH; not found.${hint}`,
      );
    }

    // Fast path: manifest matches and the binary exists.
    const manifest = await this.manifest.read();
    if (manifest.servers[recipe.name] === tc.version && (await fileExists(binaryPath))) {
      return { binaryPath };
    }

    // Inflight dedupe.
    const inflightKey = `${recipe.name}@${tc.version}`;
    let inflight = this.inflight.get(inflightKey);
    if (!inflight) {
      inflight = this.runInstall(tc, recipe.name, toolchainPath, onProgress);
      this.inflight.set(inflightKey, inflight);
      void inflight.finally(() => this.inflight.delete(inflightKey));
    }
    await inflight;

    if (!(await fileExists(binaryPath))) {
      throw new Error(
        `Install completed but binary not found at ${binaryPath}. ` +
          "Check the recipe's 'binaryRelative' path and the toolchain's output dir.",
      );
    }
    await this.manifest.setServer(recipe.name, tc.version);
    return { binaryPath };
  }

  private async runInstall(
    tc: ToolchainSpec,
    recipeName: string,
    toolchainPath: string,
    onProgress: InstallProgress | undefined,
  ): Promise<void> {
    onProgress?.(`Installing ${recipeName} via ${tc.toolchain}…`);

    // Make sure the install root exists — some toolchains require their
    // output dir to be present before they'll write into it.
    await mkdir(join(LSP_INSTALL_DIR, "bin"), { recursive: true });

    // Substitute $LSP_INSTALL_DIR in env values. Done after assembling the
    // base env so user env vars (e.g. GOPROXY, GOPRIVATE) still flow through.
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const [key, value] of Object.entries(tc.envOverrides ?? {})) {
      env[key] = value.replaceAll("$LSP_INSTALL_DIR", LSP_INSTALL_DIR);
    }

    await runProc([toolchainPath, ...tc.args], {
      cwd: LSP_INSTALL_DIR,
      env,
    });
  }
}

async function whichBinary(binary: string): Promise<string | null> {
  // Use /usr/bin/env which to find the binary on PATH. Tempest may be
  // launched from Finder where the inherited PATH is minimal, but
  // toolchains like `go` are typically on the user's shell PATH —
  // process.env at runtime contains whatever Tempest's launcher
  // resolved. Documenting this caveat: if a user has Go but launches
  // Tempest from Finder and the PATH is broken, the install will fail
  // with a clear error rather than silently misbehave.
  const proc = Bun.spawn(["/usr/bin/env", "which", binary], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || !out) return null;
  return out.split("\n")[0]?.trim() ?? null;
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
