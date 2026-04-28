# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Phase 1 of formatter support: LSP-routed `Format Document` and `Format Selection` in the Monaco editor. Adds `lspFormatting` / `lspRangeFormatting` RPC, advertises `formatting` / `rangeFormatting` client capabilities in `initialize`, and registers `DocumentFormattingEditProvider` + `DocumentRangeFormattingEditProvider` for every LSP-backed Monaco language. Servers that don't advertise the capability return null/empty and Monaco quietly does nothing — keeping the bundled formatter as the fallback for languages whose server doesn't format (notably typescript-language-server).
- Phase 2 of formatter support: `FormatterProvider` abstraction at `src/bun/formatters/` with a tiered registry that resolves *Format Document* through Prettier (project-config-gated), Ruff / Black (pyproject.toml-gated), clang-format (.clang-format-gated), gofmt / rustfmt / dart-format / terraform-fmt / shfmt (language-gated), or LSP — first match wins. Monaco's document/range formatting providers now route through a new `formatBuffer` RPC, so resolution is centralized on the bun side. Prettier binary lookup prefers `<workspacePath>/node_modules/.bin/prettier` so the project's pinned version wins. New `listFormattersForLanguage` RPC supplies the data the Phase 3 Settings UI will surface ("what would run for this file?"). The chosen formatter's display name is returned with every result so the editor can later show "Formatted with Prettier" in the footer.
- Phase 3 of formatter support: save pipeline + config schema + Settings UI. New `formatting` and `editorSaveActions` blocks on both `AppConfig` and `RepoSettings`, with a four-scope merge (app-global → app-per-language → repo-global → repo-per-language) implemented in `src/bun/formatters/config-resolver.ts`. The Monaco editor's save handler (Cmd+S, vim `:w`, Monaco's command-palette save) now resolves config bun-side, runs format-on-save, then trim-trailing-whitespace, then ensure-final-newline before writing — failures log + show in the editor header but never block the actual write. Settings dialog gains a *Formatting* tab with toggles for the three save actions, a global default-formatter picker, and a per-language overrides list populated from `listFormattersForLanguage`. The header now shows "Formatted with X" for ~3 seconds after each successful format.
- Phase 4 of formatter support: `.editorconfig` + `formatOnPaste`. New `src/bun/formatters/editorconfig.ts` parses and resolves `.editorconfig` files walking up from the buffer's directory, honoring `root = true` and `unset` per the spec. On file open, Monaco's model is configured from `indent_style` / `indent_size` / `tab_width`. The save pipeline merges `trim_trailing_whitespace` and `insert_final_newline` from `.editorconfig` on top of the user's `editorSaveActions` (editorconfig wins, since the file is committed and represents the project's intent). New `formatOnPaste` toggle (Settings → Formatting) feeds the inserted range through `formatBuffer` immediately after every paste, so snippets land in the project's style without an extra Cmd+S. New `getEditorconfig` RPC; `resolveSaveConfig` now takes an optional `filePath` so editorconfig can layer in.
- Run-button auto-detection of Gradle tasks, mirroring the existing Maven and `package.json` support. When a workspace contains `build.gradle` or `build.gradle.kts`, the scripts dropdown surfaces the standard JVM lifecycle tasks (`clean`, `build`, `assemble`, `check`, `test`, `jar`, `javadoc`, `tasks`, `dependencies`) plus plugin-specific entry points discovered from the `plugins { id … }` and `apply plugin:` blocks (Spring Boot's `bootRun`/`bootJar`, the Application plugin's `run`/`installDist`, Quarkus's `quarkusDev`, Kotlin JVM, Android, Shadow, Spotless, Flyway, Liquibase, Jib, Docker, Micronaut) and best-effort user-defined `tasks.register("…")` / `task name { … }` declarations. The Gradle wrapper (`./gradlew`) is preferred over a system `gradle` when present. New `getGradleScripts` RPC, `disableGradleScripts` / `hiddenGradleScripts` / `gradleScriptRunMode` repo settings, and a Gradle section in the Manage Scripts dialog parallel to the Maven one for per-task hide / Modal-vs-Pane configuration.

### Fixed

- Forced formatter providers now run their `applies()` check before being invoked. Previously, configuring `defaultFormatter: "lsp"` for a language whose LSP server doesn't advertise formatting (e.g. pyright for Python) would silently call the server, get back zero edits, and surface as "No changes from LSP" — indistinguishable from a successful format that found nothing to change. The pipeline now returns a clear error like *"LSP doesn't apply to this python file"* in that case, with the provider's install hint when available.
- Settings → Formatting → per-language formatter picker now filters by language: choosing an override for `python` shows only Python-eligible formatters (LSP, Black, Ruff) instead of the full list including gofmt, rustfmt, etc. The "+ Add Language" dropdown is similarly restricted to languages that have at least one eligible formatter. The global "Default Formatter" picker shows only formatters that cover multiple languages, since single-language tools make no sense as a universal default. Existing-but-no-longer-eligible selections appear as `<id> — not eligible` so users can see and clear them rather than silently dropping the value.
- The LSP tier is also dropped from the per-language picker when the user's actually-running language server doesn't advertise `documentFormattingProvider`. With pyright (a type-checker only) running for Python, "LSP" no longer appears as an option for the python override. When no matching server is running yet, LSP stays optimistically included since the answer depends on what spawns later.
- The Monaco save pipeline now guards formatter/save-action edits with model version checks, so typing while format-on-save is in flight no longer lets stale formatter output overwrite newer buffer contents.
- Format-on-paste now refuses to fall back to whole-document formatters for range requests, and ignores any unexpected full-document result instead of replacing the entire buffer after a paste.
- Monaco's bundled JSON/HTML/CSS document formatter is fully disabled when Tempest's formatter provider is installed, avoiding duplicate formatter pickers for those languages.
- `.editorconfig` resolution now treats `indent_size = tab` as independent of whether `tab_width` appears before or after it in the same section.

### Changed

- Bundled Monaco formatter is now disabled for HTML / CSS / SCSS / LESS / JSON in favor of the corresponding `vscode-langservers-extracted` LSP servers, which advertise `documentFormattingProvider`. Previously these were the only formatter for those file types; now the language server is authoritative and Monaco's project-blind bundled formatter no longer competes. TS/JS keep the bundled formatter on (typescript-language-server doesn't advertise formatting).

### Removed

## [0.21.0] - 2026-04-26

### Added

- Image viewer: opening an image file (PNG, JPEG, GIF, WebP, BMP, TIFF, ICO, HEIC/HEIF, AVIF) from the file tree, command palette, or split now opens it in a new `ImageViewer` tab kind instead of the Monaco editor (which previously rendered binary bytes as garbled text). The pane shows the image fitted to the available space on a checkerboard background with filename, dimensions, byte size, a 1:1 / Fit toggle, and a reload button. Bytes are read via a new `readImageFile` RPC and rendered as a base64 data URL. SVG continues to open in Monaco for editing. New component at `src/views/main/components/image/ImageViewerPane.tsx`; new shared helpers in `src/shared/file-types.ts`.
- "Pi (Continue)" and "Codex (Continue)" entries in the New / Split / + dropdowns, mirroring the existing Claude (Continue). They launch `pi --continue` and `codex resume --last` respectively to pick up the most recent session for the current cwd.
- Recent Files selector: a new palette (default `Cmd+E`, command `Open Recent File`) for reopening files you've recently *closed* in the current workspace. Files currently open in any pane are filtered out — the list reactively repopulates when you close a tab. Supports fuzzy filtering, arrow-key navigation, and `←` / `→` to open in a split pane. Recents are tracked per-workspace at the `addTab` chokepoint (so palette, file tree, find-in-files, go-to-definition, etc. all feed the list), capped at 50, and persisted to `session-state.json`. Component at `src/views/main/components/palette/RecentFilesPalette.tsx`; results preserve recency order rather than re-sorting by fuzzy score.

### Fixed

- Markdown viewer's Edit button now stamps the configured `editorType` (Monaco vs Neovim) directly onto the new tab instead of leaving it `undefined`. Previously the routing decision was deferred to render time — `PaneView` and `EditorPane` re-read `useStore.config.editor` to pick Monaco vs the terminal editor — so the live config setting at click time was never persisted onto the tab. Stamping at click time makes the choice explicit, locks it across config changes, and keeps it intact across session restore (where `fromNodeState` was pre-stamping a `terminalId` on every editor tab whose `editorType` was missing).

### Changed

### Removed

## [0.20.1] - 2026-04-26

### Fixed

- LSP servers no longer fail to spawn in release builds launched from Finder. NPM-installed servers (typescript-language-server, pyright, vscode-html/css/json-language-server, bash-language-server, yaml-language-server, dockerfile-language-server) ship as Node scripts whose `#!/usr/bin/env node` shebang failed under the bare macOS default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) the .app inherits when not launched from a terminal — the footer briefly showed `LSP · 1 failed` before the popover surfaced `env: node: No such file or directory`. `LspServerProcess.start` now overrides `PATH` with `getResolvedPATH()` (the same login-shell PATH the rest of the codebase already uses for git/jj/rg/gh), so `env node` finds Homebrew/nvm/cargo node regardless of how Tempest was launched.

## [0.20.0] - 2026-04-26

### Added

- Initial Language Server Protocol (LSP) integration for the Monaco editor (Phase 1). Tempest spawns one language server per `(workspace, language)` on demand, proxying hover, go-to-definition, and diagnostics through Monaco's provider API. Phase 1 ships TypeScript/JavaScript only and expects `typescript-language-server` to be on `PATH` — Phase 2 will add auto-install and broader language coverage. New Bun module at `src/bun/lsp/`: JSON-RPC framing (`jsonrpc.ts`), per-server lifecycle (`server-process.ts`), `(workspace, language)` registry with restart-on-crash document replay (`server-registry.ts`), per-uri document store, on-demand `ps`-based memory sampler, and per-language recipes. Webview registers global hover/definition providers in `src/views/main/components/editor/lsp/` and routes Monaco requests through new typed RPC methods (`lspHover`, `lspDefinition`, `lspDidOpen/Change/Close`, `lspListServers`, `lspRestart/StopServer`, `lspMemoryWatchStart/Stop`).
- Footer LSP status item with a popover listing every running server, grouped by workspace, with restart/stop controls and a tail of stderr lines for debugging. Memory (RSS) is sampled only while the popover is open — closing it stops the Bun-side `ps` poll. The aggregate footer label shows server count, working/installing notes, or error count without ever including memory.
- Renamed `UsageFooter` to a generic `Footer` host (`src/views/main/components/footer/Footer.tsx`) so additional status items (LSP today, future things tomorrow) live in one row. The token-usage display moved to `UsageItem` and is composed inside `Footer` alongside `LspItem`.
- Settings → **LSP** tab with a global "Disable LSP" toggle. Disabling tears down every running server immediately and clears Monaco markers; re-enabling brings servers back lazily on the next file open.
- Repository settings dialog gains a "Disable LSP for this repository" toggle that overrides the global setting per-repo. Toggling on tears down running servers under the repo at save time.
- New shared types: `LspServerState`, `LspDiagnostic`, `LspHoverResult`, `LspLocation`, `LspRange`, `LspPosition`, `LspMemorySample`. New `AppConfig.lspDisabled` and `RepoSettings.disableLsp` flags.
- LSP Phase 2: auto-install language servers from npm. Tempest manages its own install root at `~/.config/tempest/lsp/` (with `package.json`, `bun.lock`, and a Tempest-written `manifest.json` recording which recipe is installed at which pinned version). On first open of a supported file, the registry runs `bun add <pkg>@<version>` (deduped per package across concurrent requests) and spawns the binary out of `node_modules/.bin/`. Subsequent opens hit the manifest fast path and spawn immediately. Uses `process.execPath` to invoke bun, which works regardless of the launching shell's PATH (relevant for Tempest launched from Finder).
- New `installing` state for LSP servers, surfaced in the footer aggregate (`LSP · installing pyright…`) and in the popover with a blue status pill. Editing remains fully responsive while installs run in the background.
- Phase 2 ships eight pinned NPM-installable language servers covering most common file types: `typescript-language-server` (TS/JS/TSX/JSX) with `typescript` peer, `pyright` (Python), `vscode-html/css/json-language-server` (HTML/CSS/SCSS/LESS/JSON/JSONC, all from `vscode-langservers-extracted`), `bash-language-server` (shell), `yaml-language-server` (YAML), and `dockerfile-language-server` (Dockerfile). New module at `src/bun/lsp/installer/` houses the npm installer, a system-PATH resolver (reserved for future use), and the dispatcher.
- Footer popover's "view log" surfaces the bun stderr when an install fails, so users get an actionable error message before any server process exists.
- LSP Phase 2 fix: corrected `MonacoEditorPane`'s `<Editor>` to set `path={file://...}`, so the model URI matches what the bridge sends in `textDocument/didOpen` (without this, hover/definition/diagnostics silently no-op because the language server has no document at the queried URI).
- LSP Phase 2 fix: disabled Monaco's bundled TypeScript/JavaScript hover, definition, references, rename, document-symbols, and diagnostics providers via `setModeConfiguration` at `loader.init()` time. Phase 1's `onMount`-time call was too late for Monaco 0.55.x to retract already-registered providers, leading to duplicate hover blocks and "Definitions (2)" peek views. Completions / signatureHelp / formatting are kept on (Phase 3 will fold those into LSP).
- LSP Phase 2 fix: registered an `editor.registerEditorOpener` for `file://` URIs so Monaco's go-to-definition (and other cross-file navigations) actually open the target file in a Tempest tab via the existing `createTab` + `addTab` flow. Same-document navigations fall through to Monaco's default in-editor cursor move.
- LSP Phase 2 finish: GitHub-release and toolchain installer buckets, bringing Phase 2 to a close. The github-release bucket downloads pinned release assets, dispatches to one of four extraction modes (`none` / `gunzip` / `untar` / `unzip`), and `chmod +x`'s the resulting binary; per-recipe install dirs under `~/.config/tempest/lsp/bin/<recipe.name>/` keep different recipes' archives from colliding. The toolchain bucket verifies a required PATH binary (e.g. `go`) up front, surfaces a clear "install X from <url>" error when missing, and runs the install command with env-var token substitution (`$LSP_INSTALL_DIR` is replaced at runtime so recipes can declaratively set things like `GOBIN`).
- LSP Phase 3: completions, find references, document symbols (outline), and rename across all 18 supported language IDs.
  - **Completions**: `textDocument/completion` proxied through new `lspCompletion` RPC. Trigger characters `.`, `:`, `<`, `/`, `@`, `"`, `'` cover the common auto-popup cases across our recipes; manual invocation (`Ctrl+Space`) works on any keystroke. Snippet placeholders (`$1`, `$2`, ...) expand via Monaco's `InsertAsSnippet` rule when the server marks the item with `insertTextFormat: 2`. Cancellation is handled by checking Monaco's `CancellationToken` after the RPC roundtrip — stale results from prior keystrokes are dropped. Real `$/cancelRequest` plumbing is deferred to Phase 4.
  - **Find references**: `textDocument/references` via `lspReferences`. Renders in Monaco's existing peek view; "Find All References" includes the symbol's declaration, "Go to References" doesn't, matching Monaco's per-action `includeDeclaration` flag.
  - **Document symbols**: hierarchical `textDocument/documentSymbol` via `lspDocumentSymbols`. Powers Monaco's outline pane and breadcrumbs at the top of the editor. Server may return either the legacy flat `SymbolInformation` or hierarchical `DocumentSymbol`; the bridge normalizes to the hierarchical shape.
  - **Rename**: `textDocument/prepareRename` + `textDocument/rename` via `lspPrepareRename` / `lspRename`. Custom WorkspaceEdit application: edits to files with existing Monaco models flow through Monaco's bulk-edit machinery (proper undo/redo); edits to files not currently open as models are applied via direct `readFileForEditor` + `writeFileForEditor` round-trip in the background. Prevents a rename affecting 50 files from spawning 50 tabs while still keeping in-pane edits undoable. The spec's `defaultBehavior` and bare-Range prepareRename results are normalized to a consistent shape.
- New shared types: `LspCompletionItem`, `LspCompletionItemKind` enum, `LspCompletionList`, `LspDocumentSymbol`, `LspTextEdit`, `LspWorkspaceEdit`, `LspPrepareRenameResult`. New RPC schema entries for each.
- Disabled Monaco's bundled completions for TypeScript/JavaScript and JSON/HTML/CSS in the same `loader.init`-time config that previously disabled bundled hovers and definitions. Without this, opening a file would show LSP completions stacked alongside Monaco's project-blind ones, with duplicate / mis-ranked entries.
- Phase 3 client-capabilities + initialization fixes (caught while integrating against `typescript-language-server`):
  - **Hierarchical document symbols**: client now advertises `documentSymbol.hierarchicalDocumentSymbolSupport: true`, so servers return the modern `DocumentSymbol[]` tree (which our normalizer accepts) instead of the legacy flat `SymbolInformation[]` (which the normalizer was silently rejecting). Without this, "Go to Symbol" / `gO` was empty.
  - **Rename prep + workspace edit caps**: advertise `rename.prepareSupport`, `prepareSupportDefaultBehavior: 1`, and `workspace.workspaceEdit.documentChanges` — some servers gate semantic operations on these. Pass the same `completion.completionItem.snippetSupport` + documentation-format capabilities so completion items come back in the format we're already translating to Monaco.
  - **Forced semantic tsserver mode**: `initializationOptions.tsserver.useSyntaxServer = "never"` routes every request through the semantic server. tsserver's split-server design otherwise sometimes failed to bring up the semantic server for rename/references with a "No Project" error.
  - **`hostInfo: "tempest"` + tsserver preferences**: `providePrefixAndSuffixTextForRename`, `allowRenameOfImportPath`, completion-related flags. Matches what other LSP clients send.
  - **`disableAutomaticTypingAcquisition: true`**: type-acquisition spawns a separate downloader process that races with project loading; turning it off is safe because we already have the project's own typescript installed and removes a class of "No Project" race conditions.
- LSP Phase 4: signature help, inlay hints, and code actions across all 18 supported language IDs. The bundled Monaco versions of these features are now disabled in favor of the LSP-backed ones (same pattern Phase 1–3 used for hover/def/refs/etc).
  - **Signature help**: `textDocument/signatureHelp` proxied through `lspSignatureHelp`. Trigger characters `(` and `,` open / advance the popup; `)` retriggers. Server can return per-signature `activeParameter` overrides; the bridge passes through Monaco's matching shape so the active parameter is highlighted in the signature label.
  - **Inlay hints**: `textDocument/inlayHint` proxied through `lspInlayHints`. Forwards Monaco's visible range so the server only computes hints inside the viewport. Phase 4 v1 doesn't implement `inlayHint/resolve`, so any tooltip a server lazy-resolves won't render — most servers (notably tsserver) populate everything in the initial response.
  - **Code actions**: `textDocument/codeAction` + `workspace/executeCommand` proxied through `lspCodeActions` and `lspExecuteCommand`. Edit-bearing actions apply via the same `applyWorkspaceEdit` path rename uses; command-bearing actions register a unique Monaco command id whose handler sends `executeCommand` to the server and applies any returned WorkspaceEdit. Surfaces in Monaco's Quick Fix lightbulb and the right-click → Refactor menu. Legacy `Command[]` responses are promoted to the modern `CodeAction` shape on the Bun side.
  - **Cancellation**: `LspServerProcess.request()` now accepts an optional `AbortSignal`. On abort, sends LSP `$/cancelRequest` with the original request id and rejects the pending promise. Wired up for completions: when a fresh keystroke triggers a new completion request for the same URI, the prior in-flight request is aborted server-side, so tsserver / pyright / etc. stop computing stale results instead of backlogging while the user types.
  - New shared types: `LspSignatureHelp`, `LspSignatureInformation`, `LspParameterInformation`, `LspInlayHint`, `LspInlayHintLabelPart`, `LspInlayHintKind`, `LspCodeAction`, `LspCommand`, `LspCodeActionContext`, `LspCodeActionKind`. Client capabilities advertise `signatureHelp.signatureInformation.parameterInformation.labelOffsetSupport`, `inlayHint`, `codeAction.codeActionLiteralSupport` with the standard kind valueSet, and `executeCommand`.
  - **Inlay hint preferences for tsserver**: enabled the standard set in `initializationOptions.preferences` (`includeInlayParameterNameHints: "literals"`, `includeInlayFunctionParameterTypeHints`, `includeInlayFunctionLikeReturnTypeHints`, `includeInlayEnumMemberValueHints`, with the noisy ones — variable / property declaration hints — left off). Without these, tsserver returns an empty list to every `textDocument/inlayHint` request.
  - **`gK` vim binding**: trigger the signature help popup explicitly in vim normal mode (mnemonic: vim's `K` is "lookup keyword help", `gK` extends it to "help on this call site"). Pairs with `gO` from Phase 3 — both bind LSP features to natural-feeling vim verbs without colliding with Tempest-level shortcuts.
  - **Removed `didChange` debounce**: the previous 150 ms debounce in `lsp-bridge.ts` introduced a race where Monaco fired auto-trigger requests (signature help on `(`, completion on `.`) in the same tick as a content change, but the debounce delayed `didChange` to a later tick. Server saw the trigger before the new character and returned null — symptom: signature help silently failing on `(` while working when invoked manually. Now `didChange` fires synchronously on every `onDidChangeContent`, so requests in the same tick see consistent state.
- Five new languages: **Rust** via rust-analyzer (github/gunzip), **Lua** via lua-language-server (github/untar), **C / C++** via clangd (github/unzip), **Markdown** via marksman (github/none), and **Go** via gopls (toolchain — requires Go on PATH). Combined with Phase 2's NPM bucket, Tempest now ships LSP support for thirteen languages out of the box.
- LSP support for **Java** via `jdtls` (Eclipse JDT Language Server). Adds a system-bucket recipe in `src/bun/lsp/recipes.ts` for Monaco's `java` language id and registers `java` with the webview hover/definition provider list. jdtls doesn't slot into our auto-install buckets (binaries live on download.eclipse.org rather than GitHub releases, the tarball is ~80 MB, and the launcher needs JDK 17+ on PATH); the recipe expects `jdtls` on PATH and surfaces the standard "binary not found" error otherwise. Recommended install: `brew install jdtls`, which pulls in an openjdk dependency and provides a wrapper that handles workspace-data-dir bookkeeping automatically.
- LSP server registry now treats every non-system installer kind as "installing" while resolution is in flight, not just NPM. The footer aggregate label correctly reports `LSP · installing rust-analyzer…` while the binary downloads.
- Fixed a bug in the LSP popover's stop button — clicking it called `stopWorkspace`, which killed every server in that workspace instead of just the one. Added a single-server `stop(id)` to the registry; the popover button now stops only the row it's attached to.
- Vim normal-mode bindings for the remaining LSP actions in `MonacoEditorPane`: `gd` (go to definition), `gr` (find references), `K` (hover docs), `]d` / `[d` (next / previous diagnostic), `]D` / `[D` (last / first diagnostic in the file), `<leader>cr` (rename), `<leader>ca` (code actions / quick fix). Each is exposed as both a vim ex command (`:def`, `:refs`, `:hover`, `:diagnext`, `:diagprev`, `:diagfirst`, `:diaglast`, `:rename`, `:codeaction`) and a normal-mode map, matching the existing `gO` / `gK` pattern. `[D` / `]D` are implemented locally (sort `getModelMarkers` by document position, jump to first/last) since Monaco ships no built-in actions for them. Default mapleader in monaco-vim is `\`, so the leader bindings are `\cr` and `\ca` out of the box.
- Added `gO` vim normal-mode binding for "Go to Symbol in File" — opens Monaco's quick outline picker, populated from our LSP document-symbol provider. Drop-in replacement for Cmd+Shift+O when that shortcut is bound to something else at the Tempest level.
- Help → Keyboard Shortcuts now includes an "Editor (Vim Mode)" section listing every vim ex command + normal-mode map registered by `MonacoEditorPane` (save / quit / LSP nav / diagnostics nav / rename / code actions). Section is hidden when vim mode is off. Filter input matches against description, key sequence, and ex name.

### Fixed

- LSP review pass — six issues from a code review:
  - **Cancellation**: `LspServerRegistry.installAndStart` now captures a per-entry generation counter at the top and checks after every `await`. Stop/restart bumps the generation; in-flight installs that race with the bump bail before transitioning state, spawning, or notifying the server. Previously, stopping or restarting a server while its install was in flight could leak a running server process or resurrect a stopped one.
  - **didOpen race**: `getOrSpawn` is now synchronous (the install runs in the background). `lspDidOpen` registers the doc in the per-server `DocumentStore` immediately, so `didChange` notifications during install update the canonical text rather than no-op'ing. `installAndStart` re-snapshots `entry.docs.all()` at replay time — edits made while the user was waiting on `bun add` make it to the server once it's ready.
  - **Failed `initialize` handling**: when `proc.start()` rejects (most often because the server returns a JSON-RPC error to `initialize` while staying alive), the catch block now sets `entry.status = "error"`, records `lastError`, stops the proc, clears `entry.process`, and emits state. Previously the entry stayed stuck on `"starting"` indefinitely with no UI signal.
  - **Multi-pane refcount**: opening the same file in two Monaco panes (e.g. via splits) now reuses one bridge keyed by URI. First attach sends `didOpen` and attaches `onDidChangeContent`; subsequent attaches just bump a refcount. Only the final release sends `didClose`. `modelContext` map likewise refcounted, so unmounting one pane doesn't strip context the other still needs. Previously, the version counters drifted across panes (server saw out-of-order versions like 5, 3, 6, 4...) and the first close killed LSP for the still-open pane.
  - **NPM install serialization**: `NpmInstaller` now wraps its install + manifest commit in a single chained-promise lock so concurrent installs of different packages can't race on the shared `package.json` / `bun.lock` / `manifest.json`. Same-recipe inflight dedupe still applies. Previously, opening a TypeScript file and a Python file at the same time could run two `bun add` processes concurrently in the same dir, corrupting state.
  - **Stale markers on stop**: `stopEntry` now pushes empty-diagnostics for every URI the server had open before deleting the entry. Reuses the existing `lspDiagnostics` push channel — empty array tells the webview to clear that URI's markers. Previously, disabling LSP (globally or per-repo) or stopping a server from the popover left red squiggles on the editor for documents whose owner no longer existed.

### Changed

- Settings dialog widened from 520px to 676px (+30%) so the full tab row, including the rightmost "Keybindings" tab, fits without clipping.

### Removed

## [0.19.0] - 2026-04-24

### Added

- The scripts (green arrow) menu now auto-detects Maven `pom.xml` files alongside `package.json`. Surfaces common lifecycle phases (`clean`, `compile`, `test`, `package`, `verify`, `install`, `clean install`) plus a curated set of plugin-specific entry points when their plugin is declared in the pom (e.g. `spring-boot:run`, `quarkus:dev`, `jetty:run`, `jib:dockerBuild`, `flyway:migrate`, `liquibase:update`, `exec:java`). Prefers `./mvnw` over `mvn` when the wrapper is present. Manage Scripts dialog gains a parallel "Auto-detect scripts from pom.xml" toggle and a Maven Scripts list with the same hide/show + Modal/Pane controls. New per-repo settings: `disableMavenScripts`, `hiddenMavenScripts`, `mavenScriptRunMode`. New RPC: `getMavenScripts`.
- Monaco editor now recognizes Jsonnet (`.jsonnet`, `.libsonnet`) files. Registers a Monarch tokenizer for keywords (`local`, `function`, `import`, `self`, `super`, ...), `//` / `#` / `/* */` comments, single/double/triple-pipe (`|||...|||`) and `@`-verbatim strings, numbers, operators, and `std.*` builtins, plus language configuration for bracket matching and indent rules. Tokens reuse the existing Tempest theme rules so highlighting matches the rest of the editor.
- Codex (OpenAI's CLI coding agent) is now a first-class third coding agent alongside Claude and Pi. A "Codex" entry appears in the `+` tab menu, the **New**/**Split** toolbar menus, and the command palette (`new-codex`). Codex tabs launch `codex` through a login shell (same shell-quoting and env handling as Claude/Pi), and auto-resume the prior session on app restart.
- Chat History viewer gains a **Codex** provider toggle alongside Claude and Pi. It scans `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, lists / searches sessions with ripgrep, shows tool calls in the message stream, and offers "Resume in new tab" which launches `codex resume <uuid>`. A new Codex JSONL parser normalizes tool names (`shell`→`Bash`, `read_file`→`Read`, `apply_patch`→`Edit`, `write_file`→`Write`) so existing AI Context / ToolCallBadge filters recognize them.
- VCS AI Context now fans out across every registered history provider (Claude, Pi, Codex) via `HistoryAggregator` instead of only Claude. The diff panel will show any provider's edits to a file, not just Claude's.
- **Settings → Codex** tab for keychain-backed Codex env vars (e.g. `OPENAI_API_KEY`). Mirrors the Pi tab — values live in the macOS Keychain, only the names persist to `config.json`. Pi/Codex tabs share one `AgentEnvVarsTab` component.
- `codexPath` and `codexArgs` fields in `config.json`, and `codex` in the onboarding binary-check dialog.
- New RPC handlers: `buildCodexCommand`, `resolveCodexSessionId`, `listCodexEnvVarNames` / `setCodexEnvVar` / `deleteCodexEnvVar`.
- Files sidebar toolbar now has an **auto-reveal** toggle (↔ icon) next to the existing "Reveal active file" button. When on, the tree automatically expands and selects whatever file is open in the focused Monaco pane as you switch tabs or panes. Off by default; the setting persists in session state. The toggle preserves the tree's filter input while it follows the active file, so you can keep typing a filter without it being wiped on tab changes.

### Fixed

- Scrolling the mouse wheel over a pane now focuses it, so the wheel scrolls the pane under the cursor without requiring a click first. Moving the mouse alone no longer changes focus.
- Codex History Viewer: the "Resume in new tab" button threw a `ReferenceError` because `MessageStream` called `api.resolveCodexSessionId` without importing `api`. Added the import and a warn-on-null fallback so resolution failures (missing/malformed rollout) are diagnosable.
- Codex session-id assignment could invert for two Codex tabs opened in the same workspace: pane-tree save-time enrichment eagerly pre-filled unassigned tabs with `latestByCwd`, defeating the watcher's "prefer unassigned" match and leaving tab 1 labeled with tab 2's rollout id (and vice versa). Enrichment no longer runs on every save; persisted-tab hydration now happens once in `enrichStateForWebview` on state load.
- Codex `apply_patch` tool calls now render real diffs in the VCS AI Context panel and ToolCallBadge. The parser expands each `apply_patch` envelope into one synthetic Claude-shaped `Edit` tool call per file (`{file_path, old_string, new_string}`) so existing diff renderers work without Codex-specific branches downstream.
- `CodexSessionWatcher` can no longer spawn parallel retry chains for the same rollout when `fs.watch` fires multiple events for one new file — `handleRollout` now guards on an in-flight path set.
- The Codex metadata cache no longer caps first-prompt extraction at 50 parsed lines, so rollouts with long preamble still get a meaningful session title within the 256 KiB read window.
- Both Codex directory walkers (`CodexSessionWatcher.walk` and `CodexHistoryMetadataCache.walkForRollouts`) now skip symbolic links to avoid unbounded recursion if `~/.codex/sessions/` contains a self-referential symlink.

### Changed

- Monaco editor tabs now show the workspace-relative file path in the editor header bar instead of only the filename, making same-named files in different directories easier to distinguish.
- `AIContextProvider` now accepts a `HistoryAggregator` instead of a single `HistoryStore`. Conversation-context prefixes are now "Assistant:" (agent-agnostic) rather than "Claude:".
- The Pi-specific `buildPiEnvAssignments` helper in `SessionManager` was renamed to `buildAgentEnvAssignments(agent, names)` and is now shared between Pi and Codex.
- Pane-tree shell-cwd enrichment in `index.ts` now covers Pi and Codex tabs, not only Claude/Shell.

### Removed

### Known limitations

- Codex has no hook/extension API, so activity dots (Working / NeedsInput / Idle) don't light up for Codex tabs, Codex can't receive per-session MCP config from Tempest (the `show_webpage` / `show_mermaid_diagram` / `show_markdown` tools require adding the Tempest MCP server to `~/.codex/config.toml` manually), and there is no Codex equivalent of Claude's plan mode or permission prompts.
- Codex session-id resolution is a best-effort cwd-matched fs watcher on `~/.codex/sessions/`: if two Codex tabs launch in the same cwd within the same fs-watch tick the mapping can swap.

## [0.18.0] - 2026-04-21

### Added

- New **Help → Keymap** menu item opens a read-only "Keyboard Shortcuts" pane that lists every command with an effective keystroke, grouped by category (Command Palette, Tabs, Panes, Views, Workspace, Repositories, Claude, GitHub, App, Help). A filter input narrows by label, command id, or formatted keystroke. Also reachable as the `help.keymap` command from the palette. The listing reflects the user's active keybinding overrides from Settings.
- Git VCS view now has a **Pull / Push / Merge / Rebase** toolbar above the Working / Commit / Since Trunk selectors. **Pull** is a dropdown with `Pull` and `Fetch (all remotes)`. **Push** opens a searchable dropdown of local branches; selecting one pushes to the only remote, or opens a remote-picker dialog when more than one remote exists. **Merge** and **Rebase** open searchable dropdowns of all branches except the current one and run `git merge --no-edit <branch>` / `git rebase <branch>` respectively. Each operation reports success or the underlying git error via the existing toast and refreshes the VCS status on success.
- **Cmd+click** on a URL in a terminal pane (or a run-pane terminal) now opens it in a new Browser pane split off from the terminal, instead of the system browser. Plain click still opens in the system browser. Applies to both OSC 8 hyperlinks and auto-detected `http(s)://…` URLs in terminal output — so URLs emitted by Claude, Pi, and any shell command now route to a Tempest browser pane on Cmd+click.
- **Cmd+R** in the VCS view (Git or JJ) refreshes the view, re-fetching status, recent commits, and scoped file lists for the current workspace. Outside the VCS view the shortcut is a no-op. Also reachable as the `vcs.refresh` command from the palette ("Refresh VCS View").

### Fixed

- The top five left-activity-bar icons (Workspaces, Files, Progress, Dashboard, VCS) now behave as an exclusive radio group — only one lights up at a time. Previously, because Workspaces/Files control sidebar visibility while Dashboard/VCS control the workspace view mode, both groups could be lit simultaneously (e.g. Workspaces selected _and_ Dashboard selected). Clicking or shortcut-triggering a sidebar view now resets the workspace mode to Terminal, and entering Dashboard/VCS closes the sidebar. Toggling a mode off with the same shortcut/icon still leaves the sidebar alone.
- Browser pane no longer shows a spurious "Can't find <host>" DNS error for VPN-only hostnames. The pre-flight DNS check in the Bun backend switched from `Bun.dns.resolve` (c-ares) to `Bun.dns.lookup` (getaddrinfo). c-ares bypasses macOS's System Configuration framework and ignores VPN-injected scoped/split-DNS resolvers, so on a machine connected to a corporate VPN the pre-flight failed for hostnames that WKWebView itself could have reached. `getaddrinfo` goes through the system resolver and honors scoped DNS, so public and VPN hostnames now both pass through to the webview.

### Changed

### Removed

- The sidebar expand/collapse button in the top bar has been removed, along with the ⌘\ keyboard shortcut and the Cmd+\ menu accelerator. The "Toggle Sidebar" command still exists in the View menu and command palette, and the Workspaces / Files activity-bar icons re-open the sidebar to a specific view.

## [0.17.0] - 2026-04-21

### Added

- New **Find in Files** command (`Cmd+Shift+F`) opens a modal overlay that searches the current workspace for a plain string or regular expression via ripgrep. Results show as a flat list of `path:line` entries with the matched line inline and the matched spans bolded. Toggles for case-sensitivity (`Aa`) and regex (`.*`) sit next to the input; regex is off by default. Up/Down navigate, Enter opens the selected match in an editor tab at the correct line (Markdown files open in the Markdown viewer), Esc dismisses. Large result sets are capped at 500 matches with a "refine your query" hint; invalid regex patterns surface an inline error instead of crashing. Also reachable via the command palette.
- Browser panes now support zoom shortcuts: `Cmd+Shift+=` (i.e. `Cmd+Shift++`) zooms in and `Cmd+Shift+-` (i.e. `Cmd+Shift+_`) zooms out. Zoom is applied via CSS `zoom` on the page body, in 10% steps, clamped to [25%, 500%]. The current zoom level is re-applied on every navigation so it persists as you browse within a tab. Shortcuts are intercepted inside the WKWebView (via an injected keydown listener) so they work even when the native webview overlay has focus.
- New `show_mermaid_diagram` MCP tool lets Claude render Mermaid diagrams (flowcharts, sequence diagrams, state machines, ER diagrams, etc.) in a browser pane next to the conversation. The tool returns a `diagram_id`; passing it back on a later call updates the same pane in place instead of spawning a new one, so iterating on a diagram doesn't accumulate near-duplicate tabs. If the user closed the pane between calls, an update silently reopens a new pane bound to the same id. Diagrams are stored under `~/.config/tempest/mermaid-diagrams/<workspaceKey>/<diagram_id>.html`.
- New `show_markdown` MCP tool renders Markdown (summaries, design notes, RFC-style docs, tables, code walkthroughs) as styled HTML in a browser pane. Fenced ` ```mermaid ` blocks render as diagrams. Same update semantics as the other `show_*` tools — returns a `markdown_id`, pass it back to update in place. Files are stored under `~/.config/tempest/markdown-previews/<workspaceKey>/<markdown_id>.html`.
- Settings → MCP Tools now has independent toggles for all three MCP tools (`show_webpage`, `show_mermaid_diagram`, `show_markdown`). Previously the "Show Webpage" switch was the only one and it actually turned the whole MCP server off; now each tool is gated independently at the server's `tools/list` / `tools/call` layer. If all three are disabled, Claude no longer receives `--mcp-config` at all. Toggles take effect for the next Claude session.

### Changed

- Workspace view-mode controls (Progress, Dashboard, VCS) have moved from the top-of-page `ViewModeBar` into the left activity bar, rendered as icon buttons alongside Workspaces and Files (separated by a thin divider). The top bar now shows only the sidebar toggle and the HTTP server indicator. The explicit "Terminal" pill is gone — the Workspaces and Files activity-bar icons already correspond to Terminal mode, and clicking an already-active Dashboard or VCS icon returns the workspace to Terminal. Dashboard and VCS icons are disabled when no workspace is selected.
- Activity-bar keyboard shortcuts are now assigned top-to-bottom to match the visual order of the icons: ⌘1 Workspaces · ⌘2 Files · ⌘3 Toggle Progress · ⌘4 Toggle Dashboard · ⌘5 Toggle VCS. The Run-pane button is deliberately unbound. The Dashboard and VCS shortcuts now toggle (pressing the shortcut for the active mode returns to Terminal), matching the icon behavior. New palette commands "Show Workspaces" and "Show Files" expose the sidebar toggles; "Terminal View" remains in the palette but no longer has a default binding.
- Progress view no longer covers the left ActivityBar — it now overlays only the sidebar + workspace region, leaving the icon strip visible and clickable so the user can switch to Workspaces / Files / Dashboard / VCS (or toggle Progress off) from within Progress. Clicking Workspaces or Files (or pressing ⌘1 / ⌘2) while Progress is active also exits Progress and force-shows the chosen sidebar view instead of toggling the sidebar closed.
- `ViewModeBar` padding tuned to `pt-2 pb-1` and the macOS traffic-light Y nudged from 17 to 12 via `win.setWindowButtonPosition(16, 12)` in `src/bun/index.ts`, so the native red/yellow/green buttons line up with the HTML sidebar-toggle and HTTP icons in the top bar. The existing comment there was stale (referred to the old 40px bar) and has been refreshed to describe the new geometry.
- `show_webpage` MCP tool now supports in-place updates the same way `show_mermaid_diagram` does. It returns a `page_id`; passing it back on a later call overwrites the existing file and reloads the existing pane instead of spawning a new tab. If the user closed the pane between calls, an update silently reopens a new pane bound to the same id.

### Fixed

- Run pane scripts no longer lose their output when switching workspaces. Previously the Run pane was only mounted for the selected workspace, so leaving and returning tore down the xterm instances inside it (and killed their PTYs). All visited workspaces now keep their Run panes mounted, collapsed to zero height when hidden, so script stdout/stderr keeps streaming in the background and is intact on return.

### Removed

## [0.16.1] - 2026-04-19

### Added

- Revert changes from the Files sidebar. Right-click a modified / added / deleted / renamed / untracked file row to get a "Revert Changes" option that rolls the file back to its last committed state. A confirmation dialog guards the action. Works in both Git (via `git checkout HEAD` / unstage / delete-untracked) and JJ (via `jj restore --from @- --to @`) workspaces.

### Fixed

- Monaco editor: `:w` in vim mode now saves the file. Previously only `:wq` triggered a save (`:w` was never registered as an ex-command and silently did nothing).
- File-tree watcher no longer logs a noisy `ENOENT` stack trace when a previously expanded workspace directory has been removed (e.g. via `jj workspace forget`). The path is now silently pruned from the persisted expanded-workspaces set on the next attempt to attach a watcher.
### Changed

- Terminal scrollback is now stored in per-terminal files under `~/.config/tempest/scrollback/<terminalId>.json` (dir `0700`, files `0600`) instead of being inlined inside `session-state.json`. This shrinks `session-state.json`, keeps scrollback corruption from taking down the pane tree, avoids rewriting the whole session state on every 30s scrollback autosave, and narrows the file-permission blast radius of scrollback contents. A background GC sweep (run at startup and every 60s) removes scrollback files for terminals that are no longer in any workspace's pane tree. Existing `session-state.json` files with inline `scrollbackContent` are migrated to the new layout on first load.

### Removed

## [0.16.0] - 2026-04-19

### Added

- Find-in-page in the Markdown viewer. ⌘F opens an inline find bar; matches are highlighted in the rendered document with the current hit centered in view. Enter / Shift+Enter cycle through results, Escape closes. The search re-runs automatically after the file is reloaded on disk. Cmd+F works whether focus is on the pane chrome or inside the rendered iframe.
- Keybindings editor in Settings. All existing shortcuts now flow through a central command registry and global dispatcher, and every binding is reassignable, resettable, or can be unbound. Supports chord sequences (e.g. ⌘K ⌘S) and warns before overriding an already-bound keystroke.
- Run pane — a dockable bottom pane for long-running custom / package scripts. Each script can now be configured to run in the Run pane (PTY-backed, like a terminal) instead of the blocking modal dialog. Multiple scripts run as tabs in the pane with per-tab Restart and Stop controls. A new toggle icon at the bottom of the left activity bar shows / hides the pane; its visibility and height are persisted per workspace. Configure per-script run mode in Manage Scripts: the package scripts list now has a Modal/Pane toggle per entry, and custom scripts get a "Run in" radio selector in their editor.

### Fixed

### Changed

- Files sidebar workspace indicators now match the Workspaces sidebar. The workspace branch icon is colored by trunk alignment (green/yellow/red/gray), and a Claude activity dot appears next to the workspace name (green while working, red for needs input, dim gray when idle). The focused workspace is indicated by a green expand/collapse chevron instead of a trailing green dot. Changed files are shown with a blue label, replacing the workspace-level yellow roll-up dot. In JJ (Jujutsu) workspaces, "changed files" means files in the current `@` change (i.e. the `jj status` list) rather than Git-style uncommitted edits.

### Removed

## [0.15.0] - 2026-04-18

### Changed

- Toggle Developer Tools (⌘⌥I) now docks eruda as a 50vh bottom pane instead of a floating overlay.

### Added

- "Open User Claude Settings" / "Open Workspace Claude Settings" command palette entries open the respective `.claude/settings.json` in an Editor tab, prompting to create the workspace file if it doesn't exist yet. Both commands support open-in-split via ←/→ in the palette.
- File tree sidebar. A new activity bar (left of the resizable sidebar) toggles between Workspaces and Files views. The Files view renders a unified three-level tree — repository → workspace → files — with lazy directory loading, keyboard navigation, live filesystem watching while active, and persistence of expansion / cursor / scroll across reloads. Clicking a file reuses an existing matching tab when possible; otherwise markdown files open in a MarkdownViewer tab and everything else in an Editor tab.
- File tree Phase 2 polish: gitignored entries render at 50% opacity instead of being hidden, VCS status badges appear next to changed files (with a workspace-level roll-up dot), an inline fuzzy filter (Esc to clear), a reveal-active-file button, a right-click context menu (Open in Split, Reveal in Finder, Copy Path, Copy Relative Path), a hidden-files visibility toggle, and drag-to-pane / drag-to-terminal for file rows.

### Fixed

- Markdown viewer mouse-wheel scrolling now works on wheel mice. Wheel deltas reported in lines or pages are now scaled to pixels before being forwarded to the iframe, so each tick scrolls the expected distance instead of a few pixels.

### Changed

### Removed

## [0.14.0] - 2026-04-18

### Added

- Keychain-backed environment variables for the Pi coding agent. A new "Pi" tab in Settings lets you add, replace, and delete named secrets stored in the macOS Keychain; only the names are persisted to config. Pi inherits the resolved values on launch.
- Progress view detail panel now links to the Claude Code plan file (when one exists) for the workspace's first persisted Claude tab. Clicking jumps to the workspace and opens the plan in a MarkdownViewer tab.

### Fixed

- Progress-view Claude plan link could be permanently suppressed for sessions whose transcript slug hadn't been written yet when the first poll ran. Plan lookup no longer writes negative cache entries, and legacy ones self-heal on next read.
- Toggling Progress view (⌘5) no longer appears to wipe running programs in every tab. Progress view now overlays on top of an always-mounted workspace stack, so terminals and their scrollback survive the toggle.
- PR review now works on jj repos. Opening a PR for review no longer fails with `Revision '…@origin' doesn't exist`, and fork-based PRs open correctly.
- JJ workspaces whose names contain spaces or other special characters now appear in the sidebar. jj wraps such names in double quotes in its output; the parser now strips them before matching against the workspace directory.

### Changed

### Removed

## [0.13.2] - 2026-04-17

### Fixed

- VCS view state (scroll position, selected file, staged/partial diffs) now survives view-mode switches. Uses a lazy-first-mount + keep-alive strategy, so the view is only constructed after the user first visits VCS mode — startup and session resume pay no VCS cost.
- Terminal-driven tab updates (label, cwd, progress) now apply to terminals in background workspaces. Previously these events only landed on the currently-selected workspace's pane tree. Unchanged values short-circuit before any tree commit, so Claude streaming doesn't spam redundant updates.
- JJ description save: the log refresh after saving now uses the currently-active revset instead of a value captured when the callback was created.
- JJ Rebase, Bookmark, and Restore From dialogs no longer tear down and recreate their Escape-key listener on every parent render.
- PR detail fetcher: in-flight `getPRDetail` calls are cancelled when a row collapses, preventing setState-after-unmount and stale responses overwriting fresh state.
- Remote server Port input in Settings now clamps invalid values (`0`, negative, `>65535`) to `[1024, 65535]` instead of persisting them.
- New Workspace and Clone Repo dialogs can no longer be dismissed via Escape or backdrop click while an operation is in flight. Clone Repo also no longer wedges in the "Cloning..." state when the parent doesn't unmount synchronously on success.
- VCS view panel / file-list dividers no longer leak `mousemove` / `mouseup` listeners when the component unmounts mid-drag.
- History viewer debounced search now always invokes the current `loadSessions` callback; changing scope or provider during the debounce window no longer returns results for the old scope.
- Monaco in-editor Cmd+S binding now always calls the latest save handler (previously captured `isDirty` / `isSaving` at mount time).
- Markdown viewer now unwatches the correct file path when rapidly switching markdown files.
- Command palette ArrowLeft / ArrowRight (open in split pane) now operates on the currently selected item instead of the previously selected one.
- Scrollback autosave no longer leaks a `beforeunload` listener on each start/stop cycle.
- Rapid successive "Ask Claude about selection" calls now preserve all queued input instead of overwriting earlier entries for the same pending Claude tab.
- Custom script run dialog no longer leaks a subscription or fires `setState` on an unmounted component when dismissed before the script starts.
- Closing the last tab in the last pane now serializes the tree through the normal commit path.
- Monaco diff viewer now disposes its text models and editor on unmount, fixing a model-registry leak that grew unbounded during review sessions.
- Monaco editor link providers registered on mount are now disposed on unmount.
- Dragging a tab between panes no longer kills the PTY of the moved tab due to a read-before-write race on the pane tree.
- Terminal output ordering: guarded the gap-flush logic against a latent `NaN` edge case.
- Resolved-session-id updates now produce a new pane-tree reference (so Zustand selectors pick up the change); repeated events for the same value are a no-op.

### Changed

### Removed

## [0.13.1] - 2026-04-15

### Added

- Regression tests for PTY manager lifecycle edge cases in `src/bun/pty-manager.test.ts`, covering stale `onExit` callback handling across terminal ID reuse and cleanup of preallocated state when process spawn fails.
- Regression tests for remote terminal hub in `src/bun/remote-terminal-hub.test.ts`, covering stale-subscriber eviction on Bun send status codes (0/−1), send/close exceptions, rate-limited logging, and exit notification best-effort delivery.

### Fixed

- Session-management hardening in `src/bun/session-*`: Claude launch commands are now shell-quoted like Pi commands (fixing paths/args with spaces and preventing shell interpolation), Claude resume checks now gracefully handle missing `~/.claude/projects` without throwing, failed session-state writes keep the state marked dirty so autosave retries can succeed later, and Claude plan lookup now scans transcript files incrementally instead of loading entire JSONL files into memory.
- Tempest Remote terminal fan-out reliability in `src/bun/remote-terminal-hub.ts`: WebSocket broadcast/exit delivery now treats Bun `ws.send()` status codes (`0` dropped, `-1` backpressure) as failures instead of only handling thrown exceptions, proactively closes/removes stale subscribers after failed sends, avoids repeatedly retrying dead sockets on every PTY output frame, moves `ws.close()` out of the iteration body to prevent `detach()` re-entry during Set traversal, and logs stale-subscriber evictions at a rate-limited interval for observability.
- PTY lifecycle hardening in `src/bun/pty-manager.ts`: terminal IDs are now only fully cleaned up on the matching process `onExit` callback (instead of immediate `kill()` teardown), stale exit callbacks from older processes are ignored via process identity checks, duplicate `kill()` calls are suppressed while a terminal is terminating, create-while-terminating now returns a distinct "shutting down" error, and failed terminal creation now cleans up preallocated sequence counter state to avoid leaks.
- PR tooling hardening in `src/bun/pr` + `src/bun/hooks`: PR feedback channel routing now keys by full workspace path (URL-encoded) to avoid same-name workspace collisions across repos, PR review workspace creation now fetches PR heads via `refs/pull/<n>/head` into a dedicated local branch so fork-based PRs open reliably, resolved-thread filtering now considers up to 100 comments per thread instead of only the first, assigned-PR caching no longer gets stuck on a rejected in-flight promise, and assigned PR search now includes both `--review-requested=@me` and `--assignee=@me` results.
- MCP HTTP server hardening in `src/bun/mcp/mcp-http-server.ts`: workspace path segments are now validated to block traversal via encoded separators, JSON-RPC request parsing now rejects malformed/null payloads with `-32600 Invalid Request`, unknown methods now return proper JSON-RPC errors instead of transport-level failures, and batch requests are explicitly rejected instead of being partially processed.
- Markdown preview hardening in `src/bun/markdown`: file watching now observes parent directories so live reload survives atomic save/rename flows, markdown rendering now disallows raw input HTML to prevent script injection in previews, and fenced/indented code blocks now include `data-source-line` metadata for accurate "Ask Claude" citations.
- Main-process reliability hardening in `src/bun/index.ts`: PTY output/exit RPC sends are now guarded when the webview is unavailable during startup (post-ready failures are logged rather than silently swallowed), Claude session-file watching now auto-creates `~/.claude/sessions`, retries watcher startup after failures, and suppresses retry scheduling once shutdown has begun, and shutdown cleanup is now idempotent (single shared promise + `process.once` signal handlers) to prevent duplicate teardown work.
- Hardened Tempest Remote HTTP server security and robustness in `src/bun/http-server.ts`: removed dynamic inline-`onclick` string interpolation for repo/workspace/terminal values (replaced with `data-*` attributes + delegated click handlers), added strict JSON/body validation with `400` responses for malformed `/api/workspaces` requests, restricted query-string token auth to browser-only routes (`/`, `/terminal`, `/ws/terminals/*`) while keeping header-based auth for APIs, and bounded pending workspace prompt/mode queue growth via TTL pruning plus a max-entry cap.
- Hook/MCP reliability hardening in `src/bun/hooks`: MCP stdio framing now parses by byte length (fixing hangs on unicode payloads), SSE reconnect scheduling is deduplicated to avoid parallel duplicate event streams, and generated Claude hook commands now shell-escape hook/socket paths when they contain spaces.
- History parsing/search hardening: Claude tool-call `fullInput` now preserves nested JSON fields (fixing stripped nested `edits` payloads), ripgrep-backed history search now treats leading-dash queries as literals via `--` (so searches like `-n` work), and history metadata scanners now always close file descriptors even when reads fail.
- Hardened editor launch command construction to prevent shell interpolation issues: terminal editor commands now pass the editor binary and file arguments as positional parameters instead of string-interpolating quoted paths, and Neovim's "Open In" terminal command now passes the target directory positionally as well. This fixes failures on paths containing single quotes and closes shell-injection vectors from crafted file/workspace paths.
- AI Context timeline accuracy for VCS files: file matching now avoids basename substring collisions (e.g. `file.ts` no longer matches `file.tsx`), per-message tool calls now preserve the correct Edit/Write detail when multiple edits target the same file in one assistant message, and timeline entries are now ordered chronologically across sessions.
- Browser bookmark persistence is now robust under concurrent first-use access: bookmark loads are synchronized so parallel calls no longer see transient empty state or lose writes, and bookmark URL edits now preserve deduplication by rejecting updates that would duplicate another bookmark URL.
- Hardened config and migration startup behavior: config/repo-path JSON is now runtime-validated before use (with safe defaults for malformed data), migration markers are now written only after an error-free pass so failed copies can retry on next launch, and migration tests now exercise the real `runMigration()` flow directly.
- Usage tracking reliability in `src/bun/usage/usage-service.ts`: `--instances` project arrays are now fully aggregated across all returned entries (fixing undercounted multi-day/project totals), ccusage `stderr` is now consumed/logged on timeout and non-zero exits, and empty-cache failure responses are now marked stale so the UI can distinguish failed refreshes from fresh data.
- VCS reliability fixes in `src/bun/vcs`: git file-revert now fully restores staged-only tracked files (instead of leaving them as unstaged changes), and git/jj commit providers now invalidate cached binary paths when `config.gitPath` / `config.jjPath` changes so updated settings take effect without restarting.
- Workspace-manager hardening in `src/bun/workspace-manager.ts` + MCP plumbing: webpage preview storage is now keyed by workspace ID (preventing same-name cross-repo collisions during rename/archive cleanup), custom `scriptPath` execution now invokes zsh with the script as a file argument instead of `-c` command text, remote-repo discovery now resolves `git` via `PathResolver` with the login-shell PATH, and `removeRepo` now awaits repo-list persistence at the RPC boundary.

### Changed

### Removed

## [0.13.0] - 2026-04-14

### Added

- Tempest Remote can now attach to running terminals (shell and Claude Code) inside a workspace. Each workspace row on the remote dashboard gains a **Connect** button that opens a picker listing the workspace's live terminals; clicking one opens an xterm.js viewer in the browser that replays the cached scrollback and streams live PTY output over WebSocket. Gated by two new toggles in **Settings → Remote**: *Allow Terminal Connect* is a master switch that must be on for any remote terminal attach to work (it hides the Connect button and returns 403 from `/api/terminals`, `/ws/terminals/:id`, and `/terminal` when off), and *Allow Terminal Write* additionally lets remote viewers send keystrokes and resize events into the shared PTY. Both default to off, so out of the box the feature is fully disabled.
- Chat History viewer now supports both Claude Code and Pi sessions. A new Claude/Pi toggle in the viewer lists sessions from either provider (Pi reads `~/.pi/agent/sessions/*/*.jsonl`), with project-scope filtering keyed off the absolute `cwd` recorded in each Pi session header. The message stream also gains a "Resume in new tab" button that opens a new Claude or Pi tab pointed at the selected session — Claude via `--resume <sessionId>`, Pi via `--session <path>`. Backed by a shared `SessionHistoryProvider` interface and a `HistoryAggregator` so future features (e.g. VCS AI Context) can query both providers through one surface.
- Pi tabs now resume the previous session when Tempest restarts, matching Claude's behavior. A small Pi extension shipped with Tempest (`src/bun/hooks/pi-tempest-extension.ts`) reports the session file path on `session_start` over the existing hook Unix socket; Tempest persists the path in the saved pane tree and passes it back via `pi --session <path>` next time. Missing session files fall back to a fresh session.
- Sidebar repository collapse state now persists across restarts. Collapsing a repository in the sidebar is saved to session state, so previously collapsed repositories remain collapsed the next time Tempest starts.

### Fixed

- VCS view now correctly lists untracked files inside new directories. Previously a new file like `a/b.txt` appeared as just `a/` because `git status --porcelain=v2` collapses untracked directories by default — the row rendered with an empty filename and no diff when clicked. The status call now passes `--untracked-files=all` so each individual untracked file is reported and clickable.
- VCS view AI-tag indicators load much faster and no longer block the diff from appearing when a file is clicked. The pre-fetch is now scoped to the current worktree (via the session's encoded project path) instead of scanning every Claude session across every worktree, and parsed JSONL sessions plus their edited-file sets are cached in-memory keyed by file mtime so repeated lookups skip disk I/O and re-parsing.
- HistoryStore now prunes stale AI-context parse/edit cache entries for sessions that no longer exist, and bounds cache growth with LRU-style eviction to prevent unbounded memory usage in long-running app sessions.
- Restoring older session-state files no longer creates blank tabs from removed `diffViewer` pane tabs. Legacy unsupported tab kinds are now ignored during pane hydration.
- Updated user-facing copy to remove stale references to Diff View where VCS View is now the source of truth.
- Hardened Pi session-resume persistence: the bundled Pi extension now times out socket reporting if Tempest's hook socket is unresponsive, and pane-tree updates can request an immediate state flush so newly resolved Pi session paths are less likely to be lost on abrupt shutdown.
- Chat History now refreshes immediately when the selected workspace changes (not just when scope/provider changes), preventing stale "This Project" session lists after switching workspaces.
- Claude history search now strictly respects project scope: if a project-scoped search is requested without a resolved workspace/project path, it returns no results instead of falling back to searching all projects.

### Changed

- ⌘2 now opens VCS view (previously Diff View). ⌘4 no longer bound.

### Removed

- Diff View, superseded by VCS view which now has feature parity. The workspace view mode, pane tab type, `getDiff` RPC, diff parser/provider, and `DiffFile` shared type are all gone. Shared components (`AIContextPanel`, `InlineDiff`, `AIContextProvider`) moved out of `diff/` into new `ai-context/` folders since they're still used by VCS view.

## [0.12.0] - 2026-04-12

### Added

- New "Pi" tab type for launching the Pi coding agent. Available from the tab `+` menu, the workspace toolbar's New/Split dropdowns, and the command palette. Uses a new `piPath` / `piArgs` config and a `buildPiCommand` RPC that resolves the `pi` binary from PATH and runs it in a login shell.
- Browser URL bar now falls back to a Google search when the input doesn't look like a URL or host, instead of failing to navigate.
- Hovering over a workspace name in the sidebar now shows the full workspace path as a tooltip.
- "View PR in Browser" is now available in the command palette (previously only reachable via the PR button dropdown).
- Sidebar collapse/expand button in the view mode bar. Clicking toggles the left sidebar (equivalent to ⌘\ or the command palette's "Toggle Sidebar").
- "AI" badge in the VCS view file lists (git working changes, git scoped views, and jj revisions) marking files that Claude has edited in session history. Matches the indicator previously only available in the Diff View sidebar.

### Fixed

- Popups, dialogs, and command/file palettes now render correctly over browser panes without having to hide the whole browser. The browser stays visible behind the popup and clicks outside the popup dismiss it as expected. Uses the new `auto-mask` attribute on `<electrobun-webview>` from our Electrobun fork, which punches holes in the native WKWebView wherever host HTML overlays overlap it and routes pointer events through to the host when a modal-style wrapper is open.
- Traffic-light buttons (close/minimize/zoom) are now vertically centered inside the 40px top bar instead of being crammed into the top-left corner. Uses the new `setWindowButtonPosition` API exposed by our Electrobun fork.
- Markdown preview now scrolls with the mouse wheel. Previously only the arrow keys worked, because wheel events over the srcDoc iframe were not being forwarded to the sub-document by WKWebView. The wrapper now catches wheel events and scrolls the iframe's contentWindow manually.
- Pressing Enter inside the Open PR description textarea no longer submits the dialog; it now inserts a newline as expected. Enter still submits from the other fields.
- Clicking links with `target="_blank"` or `window.open(...)` inside a browser pane now navigates the current webview instead of being a silent no-op. Previously these clicks fired Electrobun's `new-window-open` event, which had no handler, so common links on Google results, news sites, etc. appeared dead.
- Usage footer cost for the day now matches `ccusage` output. The service was invoking ccusage with `-O` (offline pricing) between 3-hour online refreshes, but the bundled offline pricing table has incorrect rates for `claude-opus-4-6`, inflating the daily total by ~60% on cache-heavy days. Every fetch now uses live pricing.

### Changed

### Removed

## [0.11.1] - 2026-04-08

### Added

- Draft mode checkbox in Open PR dialog (checked by default)
- Browser DNS error page — when navigating to a hostname that can't be resolved, the browser pane now shows a styled error page instead of silently doing nothing.
- Uncommitted changes check when opening a PR in git repos — shows a dialog with changed files and options to commit, skip, or cancel

### Fixed

- Package scripts from the scripts dropdown now use the resolved login-shell PATH, fixing "command not found: bun" (exit 127) errors when running scripts on macOS.
- Progress view no longer offers to delete the "default" workspace
- Renamed "Archive Workspace" to "Delete Workspace" in the Progress view
- PR Review workspaces now properly run the repository's "Prepare workspace" script and propagate errors. Previously `startPRReview` silently dropped prepare-script errors from `createWorkspace`. The prepare script also now runs when reopening an existing PR workspace. Prepare-script error propagation is also fixed for regular workspace creation and the HTTP API.

### Changed

### Removed

## [0.11.0] - 2026-04-07

### Added

- Progress view (Cmd+5) — cross-workspace dashboard showing all workspaces grouped by lifecycle stage (Merged, Pull Request, In Development, New). Full-screen view with compact expandable rows, PR detail with review/check/comment status from GitHub, and quick navigation to workspace views.
- Light theme and Appearance settings tab — switch between dark and light modes via Settings → Appearance. Theme applies to all UI surfaces, terminal emulator, and Monaco editors, and persists across restarts.
- Selective package script management — "Manage Scripts" dialog now lists all detected package.json scripts with checkboxes, "Select All" and "Deselect All" buttons. Users can choose exactly which package scripts appear in the scripts dropdown.
- "Add Remote Repository" — clone a git or jj repo from a remote URL via the sidebar ellipsis menu or command palette. Supports Git and Jujutsu (with optional --colocate), auto-derives local path from URL, and adds the cloned repo to the sidebar on success.
- Rename workspace — right-click a non-default workspace and select "Rename..." to change its name. Works for both git (moves worktree) and jj (renames workspace + moves directory). Pane layout, selection, and all workspace state are preserved across the rename.

### Fixed

- Git workspace names are now derived from the directory name rather than the branch name, making workspace names independent of branches (consistent with how JJ workspaces already work)
- Open PR now correctly uses the workspace's current branch as the head branch for Git repos, instead of defaulting to "main"
- Open PR dialog now resolves the JJ bookmark from the current change (or parent if empty) instead of assuming the workspace name is the bookmark. Excludes main/master from auto-detection.
- Scripts dropdown no longer overflows the screen when a workspace has many package.json scripts. The dropdown now scrolls and "Manage Scripts" is always reachable.
- "Open In" dropdown now opens instantly — replaced per-binary shell spawning with PathResolver lookups and added a 30-second result cache
- Restore pane/tab focus when switching workspaces via sidebar
- PR Dashboard no longer floods stdout with `gh search failed` errors — assigned PRs are fetched once at startup and cached, with a manual refresh button

### Changed

- Unified Monaco editor theme ("Tempest") for both file editor and diff viewer, derived from the application's neutral-grey palette and accent colors so editors blend seamlessly with the rest of the UI
- Upgrade diff dependency to 8.0.3
- Renamed "Archive Workspace" to "Delete Workspace" in the workspace context menu

### Removed

## [0.10.0] - 2026-04-06

### Added

- "Open In" toolbar button — quickly open the current worktree in an external editor (Cursor, IntelliJ IDEA, Neovim, VS Code, Xcode, Zed), terminal (Alacritty, Apple Terminal, Ghostty, GNOME Terminal, iTerm2, Kitty, WezTerm), or file manager (Dolphin, Explorer, Finder, Nautilus). Automatically detects which apps are installed and shows them with icons in a dropdown, grouped by category.
- JJ VCS view: preset dropdown replacing raw revset input — "Since branch started" (range mode, default), "Recent Revisions" (single-revision mode), and "Custom revset" (manual entry)
- Branch health indicator in sidebar: the branch icon now shows green (up to date), yellow (needs rebase), or red (has conflicts) based on the branch's relationship to trunk. Works for both Git and JJ repos. Also replaced the branch icon SVG with a cleaner design.
- JJ VCS view: editable revset field below Revisions header (defaults to fork-point-based `heads(::@ & ::trunk())..@`) with aggregate file list and cumulative diffs across the full revision range — stable across `jj git fetch`
- "Restore From..." right-click context menu for JJ VCS file list — right-click any changed file and restore its content from another revision, with a live diff preview before confirming
- AI Context pane in Git VCS view — shows AI session history (messages, tool calls, timeline) for the selected file, matching the existing JJ view feature
- Git VCS View scope selection — view changes from any commit on the branch or all changes since main/master, in addition to the existing working tree changes view
- MCP `show_webpage` tool — Claude Code can now display HTML content (designs, mockups, diagrams) in a browser pane for visual discussions. Configurable via Settings > MCP Tools. Webpage previews persist across restarts and are cleaned up on workspace archive.
- "Revert Change" right-click context menu for Git VCS file list — right-click any uncommitted file (staged or unstaged) and choose "Revert Change" to discard modifications with a confirmation dialog. Handles modified, added, deleted, and untracked files.
- "Ask Claude" button in VCS View (both Git and JJ): select text in the Monaco diff viewer to ask Claude about it, matching existing Diff View functionality

### Fixed

- Disabled autocorrect, autocapitalize, and spellcheck on the command palette input

### Changed

- Consolidated all application data into `~/.config/tempest/` for cross-platform compatibility. Existing data is automatically migrated from `~/.tempest/` and `~/Library/Application Support/Tempest/`.
- AI Context Panel now renders Edit actions as inline unified diffs (red/green colored lines) instead of raw expandable parameters

### Removed

- Removed misleading ⌘1/⌘2/etc shortcut indicators from workspace sidebar rows (these shortcuts control view tabs, not workspace selection)

## [0.9.2] - 2026-04-05

### Added

- Add filesystem path browsing to the Open File dialog (Cmd+P) -- type an absolute path
  (`/etc/hosts`), tilde path (`~/bin`), or relative path (`./src`) to browse the filesystem
  directly. Selecting a directory drills into it; clearing the query reverts to project files.
- "Open Repo in Browser" command palette entry — opens the GitHub repo for the current workspace in a browser tab, navigating to the current branch if it has been pushed

### Fixed

- Fixed settings file proliferation in `~/.tempest/` — use content-hashed filenames instead of UUIDs, with startup cleanup of stale files
- Status indicators: only show "Working" for sessions that have received user input (`user_prompt`); 
  auto-resuming or initializing sessions stay Idle until the user actually types something
- Status indicators: `session_start` now maps to Idle instead of Working — Claude launching isn't active work
- Status indicators: unknown hook event types default to Idle instead of Working
- Status indicators: clear activity state when last Claude session ends instead of staying stuck on "Working"
- Status indicators: immediately clean stale PIDs on stop/idle events so transitions are instant
- Status indicators: sync activity state from backend on startup so webview reflects pre-existing sessions

## [0.9.1] - 2026-04-05

### Fixed

- Push initial Homebrew cask definition to the tap repo so `brew install --cask tempest` works

## [0.9.0] - 2026-04-05

### Added

- Accent line spanning the full window width below the view mode bar. Moved ViewModeBar to 
  App level so it sits above the sidebar/workspace split.
- Add HTTP server status indicator icon in the workspace toolbar — shows blue when the
  HTTP server is enabled, grey when disabled. Clicking opens the Remote settings tab.
- Auto-populate Scripts dropdown with scripts from package.json. Detects the package runner
  (bun/npm/yarn/pnpm) from lock files and runs scripts with the correct command. Refreshes
  on each dropdown open so mid-session edits to package.json are picked up.
- Add "Default Plan Mode" setting for HTTP-created workspaces — when enabled, new workspaces
  created via the HTTP remote control API start Claude in plan mode (`--permission-mode plan`).
  Configurable per-request via the `planMode` field or globally in Settings > Remote.
- Expanded terminal support to cover additional areas:
  - Add OSC 8 hyperlink support -- terminal apps can now emit clickable hyperlinks (used by GCC,
    cargo, gh CLI, and many other tools). Clicking opens in the system browser.
  - Add OSC 52 clipboard write support -- terminal apps like Neovim and tmux can now copy text to
    the system clipboard via escape sequences. Read/query is denied for security.
  - Add OSC 133 shell integration (FinalTerm protocol) -- tracks prompt and command boundaries.
    Use Cmd+Shift+Up/Down to jump between prompts in terminal scrollback.
  - Add focus event reporting (CSI ? 1004 h/l) -- apps like Neovim and tmux can now detect
    when the terminal gains or loses focus (e.g., auto-reload files on focus).
  - Add inline image support via @xterm/addon-image -- renders Sixel graphics, iTerm2 inline
    images (OSC 1337), and Kitty graphics protocol directly in the terminal.
  - Add desktop notification support (OSC 9, OSC 99) -- terminal apps can now trigger native
    macOS notifications for long-running builds, test completion, etc.
  - Add mouse pointer shape support (OSC 22) -- TUI apps can now change the cursor appearance
    (e.g., hand pointer on clickable elements).
  - Add VS Code shell integration (OSC 633) -- captures command text and CWD from VS Code's
    shell integration protocol. Deduplicates with OSC 133 prompt markers.
- Add documentation section to the website with a keyboard shortcuts reference page
- Add HTTP Remote Control Server -- an optional HTTP server that allows Tempest to be controlled
  remotely. Features bearer token authentication, configurable port, a web dashboard showing
  repos/workspaces with live status indicators, and the ability to create new workspaces with
  an initial Claude prompt. Configurable via a new "Remote" tab in Settings with enable toggle,
  listen address (with network interface selection), port, token generation, URL copy, and QR code.
- Add DMG distribution -- releases now include a polished DMG installer with drag-to-Applications
  in addition to the existing ZIP archive. Both are code-signed and notarized.
- Add Homebrew Cask support -- install via `brew tap MattFlower/recipes && brew install --cask tempest`.
  The tap is automatically updated on each release.

### Fixed

- Show error in the Remote Server settings UI and title bar icon when the HTTP server fails to
  start (e.g., port already in use) instead of silently failing with the status still showing
  as enabled. The icon turns red on error, and the settings panel displays the error message.
- Disable autocorrect and autocapitalize on workspace name input in the web dashboard
- Fix terminal process being killed when dragging a tab between panes
- Fix input becoming blocked after dragging tabs quickly between panes
- Include dotfiles and dot directories in Cmd+P file picker results

### Changed

### Removed

## [0.8.0] - 2026-04-04

### Added

- Add "Open Current Plan" command to the command palette, which finds and opens the Claude Code
  plan file for the focused Claude session in the built-in markdown viewer.
- Full Rewrite in Electrobun and Typescript, achieving parity (from what I can tell, at least)
- Introduce Monaco Editor as a built-in editor for those that don't love Neovim as much as I do
- Add dedicated markdown viewer
- Add workspace settings dialog which allows "Prepare Workspace" and "Archive Workspace" scripts
  to be run whenever a workspace is created or archived.
- For spec-driven development, add the ability to highlight text and "Ask Claude", automatically
  pasting in a reference into Claude Code to make the review process more interactive.
- VCS View -- providing similar capabilities to Diff View while also providing the ability to
  add VCS operations.
- Diff View and VCS View both have the same "Ask Claude" functionality.
- Add "Custom Scripts" -- you define parameters and a script that are run with a button.
- Add "PRs Assigned to Me" widget in Dashboard
- Capture Scrollback for terminals periodically and on shutdown -- when Tempest is started back
  up, it will be easier to see what you were working on before.
- Added ability to drag tabs to reorder panes, relocate to another pane, or drag into a new pane.

### Fixed

- Much better Claude session management -- filesystem watches immediately pick up the session
  ids for Claude sessions.

### Changed

### Removed

- Removed CEF support, as it made the distributions very large. Maybe that will come back later
  at some point.

## [0.7.10]

This was the last version of the private source Swift version of Tempest. Henceforth, this version
will be known as Tempest 1. Swift was great -- the UI may always be just a little bit better.

Seems how I don't plan to share this version with anyone else, here are the features that were the
foundation of Tempest.

### Added

- Claude Code use that is 100% legit and works with Claude Max subscriptions. My aim is to
  always remain 100% in the good graces of Anthropic.
- Add Workspaces or Archive Workspaces seamlessly, each having a separate visual space to use
  Claude, open Terminals, or open Browsers.
- Workspaces support both Git and [Jujutsu](https://jj-vcs.dev).
- "Diff View" allows you to see the changes in the most recent jj change or git commit or all
  changes since the "trunk".
- "AI Context" in Diff View provides context for the changes, linking additions, changes, or
  deletions in version control to the associated change conversions in claude.
- Multiple Panes in the main body of the application, each can contain Terminals, Claude Code,
  Browser, or Chat History
- Workspace-specific bookmarks, making it easy to link directly to places like your Github
  project, CI build, and the port your browser uses. No additional navigation needed.
- The beginnings of session storage -- Claude sessions attempt to be restored and browser tabs
  retain the urls they are looking at.
- Add "Command" menu (Cmd+Shift+p). Not only can you press enter on some tools to open in the
  current tab, but you can also use the left or right buttons to open to either side.
- Add "Open File" command (Cmd+p) that opens a Neovim in a new tab, pointing at a file.
- Ability to Open a new PR based on your local changes
- Ability to Open the current PR for your git branch / jj bookmark in the browser.
- A status indicator for each workspace indicating whether Claude is idle, working, or waiting
  for input from the user.
