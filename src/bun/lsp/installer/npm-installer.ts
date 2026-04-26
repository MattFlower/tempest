// ============================================================
// NPM-bucket installer.
//
// Installs the package named in a recipe via `bun add` into Tempest's
// managed install dir, then returns the absolute path to the spawnable
// binary in node_modules/.bin/.
//
// Concurrency contract:
//   - Same recipe + same version requested twice concurrently: deduped
//     via an inflight map. Both callers await the same install.
//   - Different recipes (or different packages) requested concurrently:
//     SERIALIZED via a chained-promise lock. `bun add` mutates the
//     shared package.json + bun.lock + node_modules; running two of
//     them in parallel in the same dir corrupts state. Manifest writes
//     happen inside the same lock so the read-modify-write of
//     manifest.json doesn't race either.
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
  /**
   * Concurrent-install dedupe keyed by `${recipe.name}@${version}`. Two
   * callers requesting the SAME recipe at the SAME version coalesce to
   * one install. Across different recipes the lock below serializes
   * them; this map just avoids duplicate work for identical requests.
   */
  private inflight = new Map<string, Promise<void>>();
  private manifest = new ManifestStore();

  /**
   * Tail of the chain-promise lock. Each install enqueues `prev → fn`
   * and replaces the tail. A failure in fn doesn't poison the chain
   * because we attach a no-op .catch when extending it (see installLock).
   */
  private lockTail: Promise<void> = Promise.resolve();

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

    // Fast path (lock-free): manifest says this version is installed AND
    // the binary is actually on disk. Both checks matter — the user
    // could have wiped node_modules manually.
    const manifest = await this.manifest.read();
    if (manifest.servers[recipe.name] === npm.version && (await fileExists(binaryPath))) {
      return { binaryPath };
    }

    // Slow path. Dedupe identical requests, serialize the rest.
    const dedupeKey = `${recipe.name}@${npm.version}`;
    let inflight = this.inflight.get(dedupeKey);
    if (!inflight) {
      inflight = this.installLock(() => this.doInstallAndCommit(recipe, onProgress));
      this.inflight.set(dedupeKey, inflight);
      void inflight.finally(() => this.inflight.delete(dedupeKey));
    }
    await inflight;

    if (!(await fileExists(binaryPath))) {
      throw new Error(
        `Install completed but binary not found at ${binaryPath}. ` +
          `Check that ${npm.package} actually ships ${npm.binary} as a bin entry.`,
      );
    }
    return { binaryPath };
  }

  /**
   * Run `fn` after the previous lock holder finishes, and update the
   * tail so the next caller waits on `fn`. Errors propagate to the
   * caller via the returned promise but don't poison subsequent lock
   * holders — the tail's `.catch(() => {})` swallows them.
   */
  private installLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.lockTail;
    const next = prev.then(fn);
    // Extend the tail with a non-rejecting promise so a failed install
    // doesn't make every future install reject as well.
    this.lockTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Inside-lock body: re-check the manifest (another caller may have
   * just installed our package while we were queued), run `bun add` if
   * needed, and commit the manifest entry. Manifest writes are
   * serialized via the same lock that protects bun's package.json
   * mutations, so concurrent calls can't lose entries.
   */
  private async doInstallAndCommit(
    recipe: ServerRecipe,
    onProgress: InstallProgress | undefined,
  ): Promise<void> {
    if (recipe.installer.kind !== "npm") return; // type-narrowing
    const npm = recipe.installer;
    const binaryPath = this.binaryPath(npm.binary);

    // Re-check inside the lock. Two recipes that share an npm package
    // (e.g. vscode-html-language-server and vscode-css-language-server
    // both backed by vscode-langservers-extracted) take this path: the
    // first installs the package, the second sees the package already
    // present and skips `bun add` — but each writes its own manifest
    // entry below.
    const manifest = await this.manifest.read();
    const packageReady = manifest.servers[recipe.name] === npm.version
      && (await fileExists(binaryPath));
    if (!packageReady) {
      await this.runBunAdd(npm, recipe.name, onProgress);
    }

    // Commit manifest entry. Read-modify-write is safe here because
    // we're inside the lock — no other install or manifest write can
    // interleave between read and write.
    await this.manifest.setServer(recipe.name, npm.version);
  }

  private async runBunAdd(
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
