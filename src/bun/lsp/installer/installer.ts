// ============================================================
// Installer dispatcher.
//
// Routes a recipe to its bucket-specific resolver and surfaces a single
// `resolve()` API for the registry. Bucket implementations live in
// sibling files; adding a new bucket means adding a case here and an
// installer kind in recipes.ts.
// ============================================================

import type { ServerRecipe } from "../recipes";
import { NpmInstaller, type InstallerResult, type InstallProgress } from "./npm-installer";
import { GithubReleaseInstaller } from "./github-release-installer";
import { ToolchainInstaller } from "./toolchain-installer";
import { SystemResolver } from "./system-resolver";

export class Installer {
  private npm = new NpmInstaller();
  private github = new GithubReleaseInstaller();
  private toolchain = new ToolchainInstaller();
  private system = new SystemResolver();

  async resolve(
    recipe: ServerRecipe,
    onProgress?: InstallProgress,
  ): Promise<InstallerResult> {
    switch (recipe.installer.kind) {
      case "npm":
        return this.npm.resolve(recipe, onProgress);
      case "github":
        return this.github.resolve(recipe, onProgress);
      case "toolchain":
        return this.toolchain.resolve(recipe, onProgress);
      case "system":
        return this.system.resolve(recipe);
      default: {
        // Exhaustiveness check: when a new installer kind is added, this
        // line forces the compiler to surface the missing case.
        const _exhaustive: never = recipe.installer;
        throw new Error(`unknown installer kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }
}
