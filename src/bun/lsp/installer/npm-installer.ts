// ============================================================
// NPM-bucket installer.
//
// Installs the package named in a recipe via `bun add` into Tempest's
// managed install dir, then returns the absolute path to the spawnable
// binary in node_modules/.bin/. Concurrent installs of the same package
// are deduped so that opening many files of one language at once doesn't
// trigger redundant work.
//
// We invoke `bun` via process.execPath rather than the literal string
// "bun" because Tempest runs as a bundled .app whose PATH may not include
// the user's shell PATH (e.g. when launched from Finder). process.execPath
// is the absolute path to the bun binary executing this code, which is
// always guaranteed to exist.
// ============================================================

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LSP_INSTALL_DIR } from "../../config/paths";
import { ManifestStore } from "./manifest";
import type { NpmInstaller as NpmInstallerSpec, ServerRecipe } from "../recipes";

export interface InstallerResult {
  binaryPath: string;
}

export interface InstallProgress {
  (line: string): void;
}

export class NpmInstaller {
  /** Concurrent-install dedupe keyed by `${package}@${version}`. */
  private inflight = new Map<string, Promise<void>>();
  private manifest = new ManifestStore();

  /**
   * Resolve a recipe to its installed binary path, installing on demand.
   * Throws on install failure with the bun stderr surfaced in the message
   * — the caller (registry) maps that to the server's "error" status so
   * the footer popover can show it.
   */
  async resolve(
    recipe: ServerRecipe,
    onProgress?: InstallProgress,
  ): Promise<InstallerResult> {
    if (recipe.installer.kind !== "npm") {
      throw new Error(`NpmInstaller can't resolve ${recipe.installer.kind} installer`);
    }
    const npm = recipe.installer;
    const binaryPath = this.binaryPath(npm.binary);

    // Fast path: manifest says this version is installed AND the binary
    // is actually on disk. Both checks matter — the user could have
    // wiped node_modules manually.
    const manifest = await this.manifest.read();
    const installedVersion = manifest.servers[recipe.name];
    if (installedVersion === npm.version && (await fileExists(binaryPath))) {
      return { binaryPath };
    }

    // Slow path: run `bun add`. Dedupe concurrent attempts on the same
    // package — three vscode-* recipes that all install
    // vscode-langservers-extracted should coalesce to one install.
    const installKey = `${npm.package}@${npm.version}`;
    let inflight = this.inflight.get(installKey);
    if (!inflight) {
      inflight = this.runInstall(npm, recipe.name, onProgress);
      this.inflight.set(installKey, inflight);
      // Use .finally to clear the cache regardless of success or failure.
      // We don't await this — failures propagate through `await inflight` below.
      void inflight.finally(() => this.inflight.delete(installKey));
    }
    await inflight;

    if (!(await fileExists(binaryPath))) {
      throw new Error(
        `Install completed but binary not found at ${binaryPath}. ` +
          `Check that ${npm.package} actually ships ${npm.binary} as a bin entry.`,
      );
    }
    await this.manifest.setServer(recipe.name, npm.version);
    return { binaryPath };
  }

  private async runInstall(
    npm: NpmInstallerSpec,
    recipeName: string,
    onProgress: InstallProgress | undefined,
  ): Promise<void> {
    onProgress?.(`Installing ${recipeName}…`);
    await this.ensureInstallDir();

    // Build argv. Each `bun add` call is incremental — Bun adds the
    // package(s) to package.json without removing existing entries. So
    // two recipes that ran sequentially (e.g. the user opened a TS file,
    // then later a Python file) build up a single package.json with
    // both servers as dependencies.
    const argv = [
      process.execPath,
      "add",
      `${npm.package}@${npm.version}`,
    ];
    for (const peer of npm.peers ?? []) {
      argv.push(`${peer.package}@${peer.version}`);
    }

    const proc = Bun.spawn(argv, {
      cwd: LSP_INSTALL_DIR,
      stdout: "pipe",
      stderr: "pipe",
      // NO_COLOR keeps the captured stderr free of ANSI escapes so the
      // popover's log tail renders cleanly.
      env: { ...process.env, NO_COLOR: "1" },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) {
      const detail = stderr.trim() || stdout.trim() || "(no output)";
      throw new Error(
        `bun add ${npm.package}@${npm.version} failed (exit ${code}): ${detail}`,
      );
    }
  }

  private async ensureInstallDir(): Promise<void> {
    mkdirSync(LSP_INSTALL_DIR, { recursive: true });
    const pkgPath = join(LSP_INSTALL_DIR, "package.json");
    if (!(await Bun.file(pkgPath).exists())) {
      await Bun.write(
        pkgPath,
        JSON.stringify(
          {
            name: "tempest-lsp",
            private: true,
            description:
              "Tempest-managed install root for LSP servers. Edit via Tempest, not by hand.",
          },
          null,
          2,
        ) + "\n",
      );
    }
  }

  private binaryPath(binary: string): string {
    return join(LSP_INSTALL_DIR, "node_modules", ".bin", binary);
  }
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
