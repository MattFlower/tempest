# Tempest — Electrobun Rewrite

## Overview
Tempest is a macOS developer tool rewritten from Swift/SwiftUI to Electrobun/TypeScript.
Two-process architecture: Bun backend + React webview frontend, communicating via typed RPC.

## Tech Stack
- **Framework:** Electrobun 1.16.0 (Bun + native WebView + CEF)
- **UI:** React 19 + Tailwind CSS 4 + Zustand
- **Terminal:** xterm.js 6 with WebGL renderer + Bun.Terminal PTY
- **Browser:** CEF via `<electrobun-webview renderer="cef">`

## Key Architectural Rules
1. **Terminal lifecycle:** Never unmount terminal components on tab switch. Use opacity-0 + pointer-events-none.
2. **PaneNode is immutable:** All tree operations return new trees.
3. **RPC hot path:** Terminal I/O uses fire-and-forget messages. Base64 encode PTY data. Sequence numbers for ordering.
4. **Microtask coalescing:** PTY output batched via queueMicrotask.

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
## Build: `/Users/mflower/.bun/bin/bun x electrobun dev`
