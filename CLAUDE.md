# Tempest — Stream D: Backend Services

## Your Scope (all Bun-process, no UI)
- `src/bun/config/app-config.ts` — Load/save config.json + repos.json
- `src/bun/config/path-resolver.ts` — Resolve binary paths from login shell PATH
- `src/bun/vcs/types.ts` — VCSProvider interface
- `src/bun/vcs/detector.ts` — Auto-detect .jj vs .git
- `src/bun/vcs/git-provider.ts` — Git worktree operations
- `src/bun/vcs/jj-provider.ts` — JJ workspace operations
- `src/bun/workspace-manager.ts` — Central repo/workspace orchestrator
- `src/bun/session-state-manager.ts` — Save/restore pane tree snapshots
- `src/bun/hooks/hook-event-listener.ts` — Unix socket server
- `src/bun/hooks/session-activity-tracker.ts` — PID → ActivityState

## Do NOT modify (owned by other streams):
- `src/views/main/*` (Streams A, B, C, E)
- `src/bun/pty-manager.ts` (Stream A)
- `src/bun/session-manager.ts` (Stream A)
- `src/bun/browser/*` (Stream C)

## You MAY update:
- `src/bun/index.ts` — Replace backend RPC stubs with real implementations
- `src/shared/ipc-types.ts` — If needed

## VCS: Use `Bun.spawn` (regular, NOT Bun.Terminal). Capture stdout via `new Response(proc.stdout).text()`.
## Socket: Use `Bun.listen({ unix: '~/.tempest/hook.sock' })` for hook events.
## Config: `~/.config/tempest/config.json` + `repos.json`. Session state: `~/.local/share/Tempest/session-state.json`.

## Swift References
- AppConfig: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Config/AppConfig.swift`
- PathResolver: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Config/PathResolver.swift`
- GitProvider: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/VCS/GitProvider.swift`
- JJProvider: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/VCS/JJProvider.swift`
- WorkspaceManager: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Workspace/WorkspaceManager.swift`
- SessionStateManager: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Session/SessionStateManager.swift`
- HookEventListener: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Hooks/HookEventListener.swift`
- SessionActivityTracker: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Hooks/SessionActivityTracker.swift`

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
