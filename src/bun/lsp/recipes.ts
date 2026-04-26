// ============================================================
// Per-language LSP server recipes.
//
// A recipe binds a Monaco language id to (a) how to install the server's
// binary and (b) what argv to spawn it with. The registry consults the
// installer at spawn time — for npm-bucket servers it runs `bun add`
// into ~/.config/tempest/lsp/, then spawns the resulting binary out of
// node_modules/.bin/. System-bucket servers (e.g. sourcekit-lsp shipped
// with Xcode) just look up a binary on PATH.
//
// Versions are pinned deliberately. Auto-update is a future concern;
// today, bumping a version is a code change that goes through review.
// ============================================================

/** NPM-installable server. We `bun add` the package into the managed
 *  install dir and spawn `node_modules/.bin/<binary>`. */
export interface NpmInstaller {
  kind: "npm";
  /** Package name on the npm registry. */
  package: string;
  /** Pinned version. Bumped only when we deliberately upgrade. */
  version: string;
  /** Bin name installed under node_modules/.bin/ — usually but not always
   *  matches the package name. Verify against `npm view <pkg> bin`. */
  binary: string;
  /** Additional packages required at runtime (e.g. `typescript` for
   *  typescript-language-server). All peers are added in the same
   *  `bun add` call so they go into one resolved dependency tree. */
  peers?: Array<{ package: string; version: string }>;
}

/** Server downloaded from a GitHub release. We fetch the asset, extract it
 *  if needed (gunzip / tar / zip), and spawn the resulting binary. Each
 *  recipe gets its own subdir under `~/.config/tempest/lsp/bin/<recipe.name>/`
 *  so different recipes' release contents don't collide. */
export interface GithubReleaseInstaller {
  kind: "github";
  /** GitHub repo as `owner/name`. Used to construct the release URL. */
  repo: string;
  /** Pinned release tag (e.g. "2026-04-20" for rust-analyzer's date tags). */
  tag: string;
  /** Per-platform asset filename. macOS-only for now; we throw on other
   *  platforms because Tempest is macOS-only. */
  asset: {
    "darwin-arm64": string;
    "darwin-x64": string;
  };
  /** What to do with the downloaded asset:
   *   - "none": asset is the binary itself (e.g. `marksman-macos`).
   *   - "gunzip": asset is a gzipped binary (rust-analyzer pattern).
   *   - "untar": asset is a `.tar.gz` archive (lua-language-server pattern).
   *   - "unzip": asset is a `.zip` archive (clangd pattern).
   *  Extraction always happens into the recipe's bin subdir.
   */
  extract: "none" | "gunzip" | "untar" | "unzip";
  /** Path to the binary, relative to the recipe's bin subdir, after
   *  extraction. For "none" / "gunzip" this is the resulting file's name;
   *  for "untar" / "unzip" it's where the binary lives inside the archive
   *  (e.g. `bin/lua-language-server` or `clangd_22.1.0/bin/clangd`). */
  binary: string;
}

/** Server installed via the user's local toolchain (e.g. `go install` for
 *  gopls). The toolchain binary must be on PATH; if it isn't, the recipe
 *  fails fast with a hint pointing the user at the install instructions.
 *
 *  Distinct from "system" — toolchain *uses* an external binary (go, java,
 *  ruby) to install the LSP server into Tempest's managed dir; "system"
 *  resolves an LSP server that the user installed themselves. */
export interface ToolchainInstaller {
  kind: "toolchain";
  /** Pinned version, used for manifest tracking. */
  version: string;
  /** Required toolchain binary that must be present on PATH. */
  toolchain: string;
  /** Human-readable hint included in the error message when the toolchain
   *  binary isn't found (e.g. "install Go from https://go.dev/dl/"). */
  toolchainHint?: string;
  /** Argv passed to the toolchain binary (e.g. ["install",
   *  "golang.org/x/tools/gopls@v0.21.1"]). */
  args: string[];
  /** Env vars to add for the install command. The string `$LSP_INSTALL_DIR`
   *  is substituted with the absolute path to the install root at runtime
   *  — useful for setting GOBIN to direct Go's output into our dir. */
  envOverrides?: Record<string, string>;
  /** Binary path relative to LSP_INSTALL_DIR after install (e.g. `bin/gopls`). */
  binaryRelative: string;
}

/** Server already on the user's PATH — we resolve its absolute path via
 *  `which` and use it as-is. Reserved for things we genuinely can't ship
 *  ourselves (e.g. sourcekit-lsp, which is bundled with Xcode). */
export interface SystemInstaller {
  kind: "system";
  /** Binary name to look up on PATH. */
  binary: string;
}

export type Installer =
  | NpmInstaller
  | GithubReleaseInstaller
  | ToolchainInstaller
  | SystemInstaller;

export interface ServerRecipe {
  /** Display name for status UI and logs. Stable identifier for the manifest. */
  name: string;
  /** Monaco-style language ids this recipe owns. */
  languageIds: string[];
  /** How to obtain the binary. */
  installer: Installer;
  /** Argv after the binary path (typically protocol-mode flags like `--stdio`). */
  args: string[];
}

const RECIPES: ServerRecipe[] = [
  // --- TypeScript / JavaScript ---
  // typescript-language-server wraps tsserver. We install both as direct
  // deps so `bun add` resolves them into one consistent tree.
  {
    name: "typescript-language-server",
    languageIds: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    installer: {
      kind: "npm",
      package: "typescript-language-server",
      version: "5.1.3",
      binary: "typescript-language-server",
      peers: [{ package: "typescript", version: "6.0.3" }],
    },
    args: ["--stdio"],
  },

  // --- Python (pyright) ---
  // The npm package ships both `pyright` (CLI type-checker) and
  // `pyright-langserver` (LSP). We want the langserver.
  {
    name: "pyright",
    languageIds: ["python"],
    installer: {
      kind: "npm",
      package: "pyright",
      version: "1.1.409",
      binary: "pyright-langserver",
    },
    args: ["--stdio"],
  },

  // --- HTML / CSS / JSON via vscode-langservers-extracted ---
  // One npm package, three separate language servers. The installer
  // dedupes by `${package}@${version}` so opening files of multiple
  // languages from this bundle doesn't reinstall the package each time.
  {
    name: "vscode-html-language-server",
    languageIds: ["html"],
    installer: {
      kind: "npm",
      package: "vscode-langservers-extracted",
      version: "4.10.0",
      binary: "vscode-html-language-server",
    },
    args: ["--stdio"],
  },
  {
    name: "vscode-css-language-server",
    // Monaco's css/scss/less are separate language ids but vscode-css-ls
    // handles all three with the same binary; first-open of any maps to
    // this recipe.
    languageIds: ["css", "scss", "less"],
    installer: {
      kind: "npm",
      package: "vscode-langservers-extracted",
      version: "4.10.0",
      binary: "vscode-css-language-server",
    },
    args: ["--stdio"],
  },
  {
    name: "vscode-json-language-server",
    languageIds: ["json", "jsonc"],
    installer: {
      kind: "npm",
      package: "vscode-langservers-extracted",
      version: "4.10.0",
      binary: "vscode-json-language-server",
    },
    args: ["--stdio"],
  },

  // --- Bash / shell ---
  {
    name: "bash-language-server",
    languageIds: ["shell"],
    installer: {
      kind: "npm",
      package: "bash-language-server",
      version: "5.6.0",
      binary: "bash-language-server",
    },
    args: ["start"],
  },

  // --- YAML ---
  {
    name: "yaml-language-server",
    languageIds: ["yaml"],
    installer: {
      kind: "npm",
      package: "yaml-language-server",
      version: "1.22.0",
      binary: "yaml-language-server",
    },
    args: ["--stdio"],
  },

  // --- Dockerfile ---
  // Note: package name is `dockerfile-language-server-nodejs` but the
  // installed bin is `docker-langserver`.
  {
    name: "dockerfile-language-server",
    languageIds: ["dockerfile"],
    installer: {
      kind: "npm",
      package: "dockerfile-language-server-nodejs",
      version: "0.15.0",
      binary: "docker-langserver",
    },
    args: ["--stdio"],
  },

  // --- Rust (rust-analyzer) ---
  // Asset is a gzipped binary — gunzip strips the .gz suffix in place.
  // Tags are date-based; bump deliberately when upgrading.
  {
    name: "rust-analyzer",
    languageIds: ["rust"],
    installer: {
      kind: "github",
      repo: "rust-lang/rust-analyzer",
      tag: "2026-04-20",
      asset: {
        "darwin-arm64": "rust-analyzer-aarch64-apple-darwin.gz",
        "darwin-x64": "rust-analyzer-x86_64-apple-darwin.gz",
      },
      extract: "gunzip",
      binary: "rust-analyzer",
    },
    args: [],
  },

  // --- Lua (lua-language-server) ---
  // Tarball extracts to `bin/`, `main.lua`, and friends in the install
  // root. The launcher script in `bin/lua-language-server` is what we
  // spawn; it locates `main.lua` relative to itself, so the whole tree
  // must stay intact.
  {
    name: "lua-language-server",
    languageIds: ["lua"],
    installer: {
      kind: "github",
      repo: "LuaLS/lua-language-server",
      tag: "3.18.2",
      asset: {
        "darwin-arm64": "lua-language-server-3.18.2-darwin-arm64.tar.gz",
        "darwin-x64": "lua-language-server-3.18.2-darwin-x64.tar.gz",
      },
      extract: "untar",
      binary: "bin/lua-language-server",
    },
    args: [],
  },

  // --- C / C++ (clangd) ---
  // Note: same asset for both arches — clangd-mac-* is a fat binary that
  // runs on both Apple Silicon and Intel.
  // Zip extracts with a version-prefixed dir, so the binary lives at
  // `clangd_22.1.0/bin/clangd` (NOT `bin/clangd`).
  {
    name: "clangd",
    languageIds: ["c", "cpp"],
    installer: {
      kind: "github",
      repo: "clangd/clangd",
      tag: "22.1.0",
      asset: {
        "darwin-arm64": "clangd-mac-22.1.0.zip",
        "darwin-x64": "clangd-mac-22.1.0.zip",
      },
      extract: "unzip",
      binary: "clangd_22.1.0/bin/clangd",
    },
    args: [],
  },

  // --- Markdown (marksman) ---
  // Asset is the binary itself (no extract). Same asset for both arches.
  {
    name: "marksman",
    languageIds: ["markdown"],
    installer: {
      kind: "github",
      repo: "artempyanykh/marksman",
      tag: "2026-02-08",
      asset: {
        "darwin-arm64": "marksman-macos",
        "darwin-x64": "marksman-macos",
      },
      extract: "none",
      binary: "marksman-macos",
    },
    args: ["server"],
  },

  // --- Go (gopls via `go install`) ---
  // GOBIN steers Go's output into Tempest's managed bin dir so the
  // resulting `gopls` binary doesn't pollute the user's $GOPATH/bin.
  {
    name: "gopls",
    languageIds: ["go"],
    installer: {
      kind: "toolchain",
      version: "v0.21.1",
      toolchain: "go",
      toolchainHint: "Install Go from https://go.dev/dl/",
      args: ["install", "golang.org/x/tools/gopls@v0.21.1"],
      envOverrides: { GOBIN: "$LSP_INSTALL_DIR/bin" },
      binaryRelative: "bin/gopls",
    },
    args: [],
  },

  // --- Java (Eclipse JDT Language Server) ---
  // jdtls doesn't fit our auto-install buckets cleanly: prebuilt
  // distributions live on download.eclipse.org (not GitHub releases),
  // the tarball is ~80 MB, and the launcher needs a JDK 17+ on PATH.
  // We expect the user to install it themselves — `brew install jdtls`
  // pulls in a Homebrew openjdk dependency and drops a `jdtls` wrapper
  // on PATH that handles workspace-data-dir bookkeeping for us.
  {
    name: "jdtls",
    languageIds: ["java"],
    installer: {
      kind: "system",
      binary: "jdtls",
    },
    args: [],
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

/** All registered recipes. Useful for diagnostics and a future "preinstall all" path. */
export function allRecipes(): ServerRecipe[] {
  return RECIPES.slice();
}
