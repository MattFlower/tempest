# Tempest — Stream A: Terminal System + PTY Manager

## Your Scope
You own the terminal subsystem. Implement these files:
- `src/bun/pty-manager.ts` — Multi-terminal PTY management via Bun.Terminal
- `src/bun/session-manager.ts` — Build claude/shell/editor command strings with env, hooks
- `src/bun/hooks/hook-settings-builder.ts` — Write temp JSON settings for Claude --settings
- `src/views/main/components/terminal/terminal-instance.ts` — xterm.js lifecycle class
- `src/views/main/components/terminal/TerminalPane.tsx` — React wrapper component

## Do NOT modify (owned by other streams):
- `src/views/main/App.tsx` (Stream E)
- `src/views/main/components/layout/*` (Stream B)
- `src/views/main/components/browser/*` (Stream C)
- `src/views/main/components/sidebar/*` (Stream E)
- `src/bun/workspace-manager.ts` (Stream D)

## You MAY update:
- `src/bun/index.ts` — Replace Terminal/Session RPC stubs with real implementations
- `src/shared/rpc-schema.ts` — Only if you need terminal-specific fields

## Prototype Reference
Working prototype at `~/code/tempest-electrobun-prototype/`. Carry forward:
- **Microtask coalescing** (`queueMicrotask`) for PTY output batching
- **Base64 encoding** for PTY data over RPC
- **Sequence numbers** for ordered delivery
- **CSI u keyboard** for Ctrl+/ etc. Ctrl+letter: send ASCII control codes manually (WebKit bug)
- **WebGL renderer** with canvas fallback on context loss
- **ResizeObserver** with 16ms debounce, 50x50px min guard

## Session Manager (port from Swift)
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Session/SessionManager.swift`
- `buildClaudeCommand()`: resolve path, add --resume/--settings/--dangerously-skip-permissions, wrap in `/bin/zsh -lic 'exec ...'`
- `buildShellCommand()`: login shell at workspace path
- Hook settings: temp JSON at `~/.tempest/settings-*.json`

## Terminal Env
Set: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=tempest`
Clear: `GHOSTTY_RESOURCES_DIR`, `GHOSTTY_BIN_DIR`, `GHOSTTY_SHELL_INTEGRATION_NO_SUDO`

## xterm.js Config
`macOptionIsMeta: true`, `allowTransparency: false`, `smoothScrollDuration: 0`, `minimumContrastRatio: 1`
Font: `"MesloLGS Nerd Font", "SF Mono", Menlo, monospace` 14px. Theme: Catppuccin Mocha.

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
