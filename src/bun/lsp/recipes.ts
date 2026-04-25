// ============================================================
// Per-language LSP server recipes.
//
// Phase 1 only ships the typescript-language-server recipe and expects the
// binary to already be on PATH. Phase 2 will replace the simple `command`
// field with an installer-aware resolver (npm, github release, toolchain).
// Keep the surface here minimal — the registry only needs to know:
//   - which Monaco language id this recipe handles
//   - how to spawn it
// ============================================================

export interface ServerRecipe {
  /** Display name for status UI and logs. */
  name: string;
  /** Monaco-style language ids this recipe owns. */
  languageIds: string[];
  /**
   * Argv to run the server in stdio mode. Phase 1 assumes the binary is on
   * PATH — phase 2 swaps this for a recipe.resolve() call that installs +
   * returns the absolute path.
   */
  command: string[];
}

const RECIPES: ServerRecipe[] = [
  {
    name: "typescript-language-server",
    // Monaco uses "typescript" / "javascript" / "typescriptreact" / "javascriptreact"
    // as separate language ids. typescript-language-server handles all four.
    languageIds: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    command: ["typescript-language-server", "--stdio"],
  },
];

/**
 * Pick a recipe for a Monaco language id. Returns undefined when no recipe
 * is registered — the registry treats that as "no LSP for this file" and
 * the editor falls back to Monaco's bundled behaviour.
 */
export function recipeForLanguage(languageId: string): ServerRecipe | undefined {
  return RECIPES.find((r) => r.languageIds.includes(languageId));
}
