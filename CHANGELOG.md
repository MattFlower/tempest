# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

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

