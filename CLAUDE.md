# Tempest — Electrobun Rewrite

## Overview
Tempest is a macOS developer tool being rewritten from Swift/SwiftUI to Electrobun/TypeScript.
Two-process architecture: Bun backend + React webview frontend, communicating via typed RPC.

## Tech Stack
- **Framework:** Electrobun 1.16.0 (Bun runtime + native WebView + optional CEF)
- **UI:** React 19 + Tailwind CSS 4 + Zustand
- **Terminal:** xterm.js 6 with WebGL renderer + Bun.Terminal PTY
- **Browser:** CEF via `<electrobun-webview renderer="cef">`
- **Build:** `bun x electrobun dev` (dev), `bun x electrobun build` (prod)
- **Use Bun at** `/Users/mflower/.bun/bin/bun` (version 1.3.11)

## Project Structure
- `src/shared/` — Types and RPC schema shared between processes
- `src/bun/` — Bun process (PTY, workspaces, VCS, hooks, config)
- `src/views/main/` — React webview (pane layout, terminals, browser, sidebar)

## Key Architectural Rules
1. **Terminal lifecycle:** Never unmount terminal components on tab switch. Use opacity-0 + pointer-events-none to hide. Unmounting destroys the xterm.js instance and loses scrollback.
2. **PaneNode is immutable:** All tree operations return new trees. Never mutate in place.
3. **RPC hot path:** Terminal I/O uses fire-and-forget messages (not requests) to minimize latency. Base64 encode PTY data. Use sequence numbers for ordering.
4. **Microtask coalescing:** PTY output batched via queueMicrotask, not setTimeout.
5. **CSI u keyboard protocol:** Use for Ctrl+/ and other non-letter Ctrl combos. Let xterm.js handle Ctrl+letter natively (but send ASCII control codes manually since WebKit's native handling doesn't work).

## Bun API Preferences
- Use `Bun.spawn` for process execution (with `terminal` option for PTY)
- Use `Bun.file` / `Bun.write` over `node:fs` readFile/writeFile
- Use `Bun.listen` for Unix socket servers
- Use `bun:test` for testing

## Commands
- `/Users/mflower/.bun/bin/bun x electrobun dev` — Dev build + run
- `/Users/mflower/.bun/bin/bun test` — Run tests
