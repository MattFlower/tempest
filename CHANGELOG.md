# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
