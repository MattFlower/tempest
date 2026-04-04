# Tempest — Electrobun Rewrite

## Overview

Tempest is a macOS developer tool rewritten from Swift/SwiftUI to Electrobun/TypeScript.
Two-process architecture: Bun backend + React webview frontend, communicating via typed RPC.

## Tech Stack

- **Framework:** Electrobun 1.16.0 (Bun + native WebView)
- **UI:** React 19 + Tailwind CSS 4 + Zustand
- **Terminal:** xterm.js 6 with WebGL renderer + Bun.Terminal PTY
- **Browser:** System webview (WKWebView on macOS) via `<electrobun-webview>`

## Key Architectural Rules

1. **Terminal lifecycle:** Never unmount terminal components on tab switch. Use opacity-0 + pointer-events-none.
2. **PaneNode is immutable:** All tree operations return new trees.
3. **RPC hot path:** Terminal I/O uses fire-and-forget messages. Base64 encode PTY data. Sequence numbers for ordering.
4. **Microtask coalescing:** PTY output batched via queueMicrotask.

## Build: `bun x electrobun dev` (requires Bun >= 1.3.11)

## Changelog

- Whenever making changes, add an appropriate entry in the "Unreleased" section of CHANGELOG.md.

## Releasing

When the user asked for a release to be made, do the following:

1. Suggest a version number for the release to the user based on the items in CHANGELOG.md
2. Once a version number has been confirmed with the user, change the "Unreleased" section of the
   CHANGELOG.md to be named after the release.
   3a. If the repo is a jujutsu repo (it has a .jj directory), tag with `jj tag set` and push with `jj git push`
   3b. If the repo is git repo (it has a .git dir but not a .jj dir), tag the release with `git tag` and push with `git push`
3. The release should contain the information that was in the former "Unreleased" section of the Changelog.
