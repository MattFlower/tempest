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

## Coding Agents

Tempest supports three terminal-hosted coding agents. Their integration depth differs because each CLI exposes different extension points.

| Capability | Claude | Pi | Codex |
| --- | --- | --- | --- |
| Launch via `+` menu / palette | Yes | Yes | Yes |
| Resume prior session on restart | PID file (`~/.claude/sessions/{pid}.json`) | Extension reports path via hook socket | fs watcher on `~/.codex/sessions/`, matched by cwd |
| History viewer (list / search / view) | Yes | Yes | Yes |
| AI Context in VCS (edits for a file) | Yes | Yes | Yes |
| Per-session MCP tool injection (`show_webpage`, `show_mermaid_diagram`, `show_markdown`) | Yes (`--mcp-config`) | — | **No** — Codex reads MCP from `~/.codex/config.toml` globally |
| Plan mode | Yes (`--permission-mode plan`) | — | **No** |
| Activity dots (Working / NeedsInput / Idle) | Yes, via hook events | Partial, via Pi extension | **No** — Codex has no hook/extension API |
| Permission-prompt integration | Yes | — | **No** |
| Keychain env vars | — | Yes (`piEnvVarNames`) | Yes (`codexEnvVarNames`) |

Codex session-id resolution is best-effort: if two Codex tabs launch in the same cwd within the fs-watch debounce window, their assignments can swap. Session lookup prefers tabs that don't yet have a resolved id.

## Build: `bun x electrobun dev` (requires Bun >= 1.3.11)

## Changelog

- Whenever making changes, add an appropriate entry in the "Unreleased" section of CHANGELOG.md.

## Releasing

Use the `/release` skill to cut a release. It handles changelog updates, tagging, pushing, and verifying the GitHub release.
