# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

- Much better Claude session management -- filesystem watches immediately pick up the session
  ids for Claude sessions.

### Removed

- Removed CEF support, as it made the distributions very large. Maybe that will come back later
  at some point.

## [0.7.10]

This was the last version of the private source Swift version of Tempest. Henceforth, this version
will be known as Tempest 1. Swift was great -- the UI may always be just a little bit better.

Seems how I don't plan to share this version with anyone else, here are the features that were the
foundation of Tempest.

### Added

- Add Workspaces or Archive Workspaces seamlessly, each having a separate visual space to use
  Claude, open Terminals, or open Browsers.
- Workspaces support both Git and [Jujutsu](https://jj-vcs.dev).
- "Diff View" allows you to see the changes in the most recent jj change or git commit or all
  changes since the "trunk".
- "AI Context" in Diff View provides context for the changes, linking additions, changes, or
  deletions in version control to the associated change conversions in claude.
- Multiple Panes in the main body of the application, each can contain Terminals, Claude Code,
  Browser, or Chat History
- The beginnings of session storage -- Claude sessions attempt to be restored.
- Add "Command" menu (Cmd+Shift+p). Not only can you press enter on some tools to open in the
  current tab, but you can also use the left or right buttons to open to either side.
- Add "Open File" command (Cmd+p) that opens a Neovim in a new tab, pointing at a file.
