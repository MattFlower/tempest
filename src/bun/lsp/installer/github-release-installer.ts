// ============================================================
// GitHub-release bucket installer.
//
// Downloads the recipe's pinned asset from
// `https://github.com/<repo>/releases/download/<tag>/<asset>`, extracts
// it (none / gunzip / untar / unzip), and returns the absolute path to
// the resulting binary. Each recipe gets its own subdir under the
// install root so different recipes' archives don't collide on
// overlapping filenames (e.g. `bin/clangd`).
//
// We use the system `tar`, `unzip`, and `gunzip` tools rather than a
// userland archive library — they're always present on macOS and avoid
// adding another runtime dependency for the bundle.
// ============================================================

import { mkdir, rename, rm, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { LSP_INSTALL_DIR } from "../../config/paths";
import { ManifestStore } from "./manifest";
import { detectPlatform } from "./platform";
import { runProc } from "./proc";
import type { GithubReleaseInstaller as GithubSpec, ServerRecipe } from "../recipes";
import type { InstallerResult, InstallProgress } from "./npm-installer";

export class GithubReleaseInstaller {
  private inflight = new Map<string, Promise<void>>();
  private manifest = new ManifestStore();

  /**
   * Resolve a github-release recipe to its installed binary path. Downloads
   * + extracts on demand. Throws on network or extraction failure with the
   * underlying error in the message — the caller maps that to the server's
   * `error` status so the footer popover surfaces it.
   */
  async resolve(
    recipe: ServerRecipe,
    onProgress?: InstallProgress,
  ): Promise<InstallerResult> {
    if (recipe.installer.kind !== "github") {
      throw new Error(
        `GithubReleaseInstaller can't resolve ${recipe.installer.kind} installer`,
      );
    }
    const gh = recipe.installer;
    const platform = detectPlatform();
    const assetName = gh.asset[platform];
    if (!assetName) {
      throw new Error(`${recipe.name} has no release asset for ${platform}`);
    }

    const installRoot = recipeInstallRoot(recipe.name);
    const binaryPath = join(installRoot, gh.binary);

    // Fast path: manifest version matches AND the binary is on disk.
    const manifest = await this.manifest.read();
    if (manifest.servers[recipe.name] === gh.tag && (await fileExists(binaryPath))) {
      return { binaryPath };
    }

    // Slow path: download + extract. Dedupe concurrent attempts at the
    // same recipe@tag — without this, a user opening five .rs files at
    // once would download rust-analyzer five times.
    const inflightKey = `${recipe.name}@${gh.tag}`;
    let inflight = this.inflight.get(inflightKey);
    if (!inflight) {
      inflight = this.runInstall(gh, recipe.name, assetName, installRoot, onProgress);
      this.inflight.set(inflightKey, inflight);
      void inflight.finally(() => this.inflight.delete(inflightKey));
    }
    await inflight;

    if (!(await fileExists(binaryPath))) {
      throw new Error(
        `Install completed but binary not found at ${binaryPath}. ` +
          "Check that the recipe's 'binary' path matches the archive layout.",
      );
    }
    // Some archives don't preserve the executable bit (especially zips
    // produced on Windows). Idempotent chmod keeps us safe regardless.
    try {
      await chmod(binaryPath, 0o755);
    } catch {
      // chmod failures are recoverable — the binary may already be executable.
    }
    await this.manifest.setServer(recipe.name, gh.tag);
    return { binaryPath };
  }

  private async runInstall(
    gh: GithubSpec,
    recipeName: string,
    assetName: string,
    installRoot: string,
    onProgress: InstallProgress | undefined,
  ): Promise<void> {
    onProgress?.(`Downloading ${recipeName}@${gh.tag}…`);

    // Wipe + recreate the install root so old version's files don't
    // linger alongside new ones (especially relevant for tarballs that
    // create version-named subdirs like `clangd_22.1.0/`).
    await rm(installRoot, { recursive: true, force: true });
    await mkdir(installRoot, { recursive: true });

    const url = `https://github.com/${gh.repo}/releases/download/${gh.tag}/${assetName}`;
    const downloadPath = join(installRoot, assetName);

    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} downloading ${url}`);
    }
    // Bun.write accepts a Response and streams it to disk efficiently.
    await Bun.write(downloadPath, resp);

    onProgress?.(`Extracting ${recipeName}…`);
    switch (gh.extract) {
      case "none":
        // The asset *is* the binary. If `gh.binary` differs from the
        // asset filename, rename so the registry's spawn path is stable.
        if (assetName !== gh.binary) {
          await rename(downloadPath, join(installRoot, gh.binary));
        }
        break;

      case "gunzip": {
        // gunzip strips the .gz suffix in place. If the resulting name
        // doesn't match `gh.binary`, rename to the recipe's expected name.
        await runProc(["gunzip", "-f", downloadPath]);
        const stripped = downloadPath.replace(/\.gz$/, "");
        const target = join(installRoot, gh.binary);
        if (stripped !== target) {
          await rename(stripped, target);
        }
        break;
      }

      case "untar":
        // -x extract, -z gzip, -f file. macOS tar handles bsdtar-style
        // long-name extension just fine for these archives.
        await runProc(["tar", "-xzf", downloadPath, "-C", installRoot]);
        await unlink(downloadPath);
        break;

      case "unzip":
        // -q quiet, -o overwrite without prompting.
        await runProc(["unzip", "-q", "-o", downloadPath, "-d", installRoot]);
        await unlink(downloadPath);
        break;
    }
  }
}

function recipeInstallRoot(recipeName: string): string {
  return join(LSP_INSTALL_DIR, "bin", recipeName);
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
