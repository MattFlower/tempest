# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

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
