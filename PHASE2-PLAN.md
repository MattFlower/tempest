# Tempest2 Phase 2: Full Feature Parity Plan

## Current State (Phase 1 Complete)

Tempest2 has **5,739 LOC across 45 files** implementing:
- Terminal system (xterm.js + Bun.Terminal PTY with microtask coalescing, sequence ordering, CSI u keyboard)
- Pane layout (immutable recursive tree, split/maximize/focus, tab drag/drop, divider resize)
- Browser tabs (CEF webview, toolbar, find bar, bookmarks)
- Sidebar (repo sections, workspace rows, activity dots, diff stats)
- Command palette (fuzzy search, keyboard nav, left/right pane opening)
- Workspace management (git/jj providers, create/archive)
- Session save/restore (compatible with Swift Tempest format)
- Hook events → activity indicators
- Application menus
- Config loading from ~/.config/tempest/config.json

## Features Needed for Full Parity

### Feature 1: Diff Viewer (~1,500 LOC Swift → ~1,200 LOC TypeScript)

**What it does:** Displays syntax-highlighted unified diffs with file tree, hunk navigation, side-by-side mode, right-click to open in editor, and an AI context panel showing Claude's edits to files.

**Swift source files:**
| File | Path | Lines | What it does |
|------|------|-------|-------------|
| DiffModels.swift | Tempest/DiffView/DiffModels.swift | 104 | FileDiff, DiffHunk, DiffLine, DiffSet data structures |
| DiffProvider.swift | Tempest/DiffView/DiffProvider.swift | 175 | VCS diff fetching + unified diff parser (parses `@@ -old,count +new,count @@` hunks) |
| DiffRenderer.swift | Tempest/DiffView/DiffRenderer.swift | 15 | Protocol abstraction |
| WebDiffRenderer.swift | Tempest/DiffView/WebDiffRenderer.swift | 306 | WKWebView with diff2html.js + highlight.js, right-click line number extraction |
| DiffView.swift | Tempest/DiffView/DiffView.swift | 190 | Main orchestrator: HSplitView with file tree + diff + AI panel |
| FileTreeView.swift | Tempest/DiffView/FileTreeView.swift | 150 | File list sidebar with M/A/D/R badges and AI context indicators |
| DiffHeaderView.swift | Tempest/DiffView/DiffHeaderView.swift | ~80 | Header with file name, hunk prev/next, mode toggle |
| AIContextPanelView.swift | Tempest/DiffView/AIContextPanelView.swift | 268 | Shows Claude's edits: message bubbles, tool call waypoints, timeline navigation |
| AIContextModels.swift | Tempest/DiffView/AIContextModels.swift | ~60 | FileAIContext, FileChangeTimeline data structures |
| AIContextProvider.swift | Tempest/DiffView/AIContextProvider.swift | ~100 | Searches HistoryStore for sessions with edits to a file |

**Bundled JS libraries (copy from Tempest1):**
- `diff2html.min.js` (66K) + `diff2html.min.css` (17K) — at `Tempest/DiffView/Rendering/Resources/`
- `highlight.min.js` (119K) + `highlight-dark.min.css` (1.3K) — at `Tempest/SharedResources/`

**Implementation approach for Tempest2:**
- Use npm packages instead of bundled JS: `bun add diff2html highlight.js`
- Render diff HTML in a native WebKit `<electrobun-webview renderer="native">` (not CEF — lighter weight)
- The webview loads an HTML page that imports diff2html and renders the diff
- Communicate between React and the diff webview via postMessage or Electrobun's webview RPC
- Unified diff parser port: `DiffProvider.swift` lines 20-174 → `src/bun/diff/diff-parser.ts`
- AI context panel is a React component (not in webview)
- File tree is a React component with status badges

**Key implementation details:**
- `WebDiffRenderer.swift` lines 76-304: HTML template with diff2html config `{ drawFileList: false, matching: 'lines' }`
- Language detection map (lines 36-74): swift→swift, js→javascript, tsx→typescript, py→python, etc.
- Right-click handler (lines 243-293): extracts new-file line number from diff2html DOM, sends via message handler
- Diff scopes: currentChange, sinceTrunk, singleCommit(ref) — already in `src/shared/ipc-types.ts`

**RPC additions needed:**
```typescript
getDiff: { params: { workspacePath: string; scope: DiffScope; contextLines?: number }; response: { raw: string; files: FileDiff[] } }
```

**Complexity: HIGH — 3-4 days**
- Diff parsing is non-trivial but well-documented in Swift source
- diff2html integration straightforward via npm
- AI context panel depends on History Viewer (Feature 2)

---

### Feature 2: History Viewer (~1,200 LOC Swift → ~900 LOC TypeScript)

**What it does:** Browses Claude Code conversation history, searches with ripgrep, displays message streams with tool call visualization.

**Swift source files:**
| File | Path | Lines | What it does |
|------|------|-------|-------------|
| HistoryStore.swift | Tempest/History/HistoryStore.swift | 214 | Facade: coordinates cache + ripgrep, 30s refresh timer |
| HistoryMetadataCache.swift | Tempest/History/HistoryMetadataCache.swift | 270 | Scans ~/.claude/projects/, caches metadata (firstPrompt, createdAt, gitBranch) |
| JSONLParser.swift | Tempest/History/JSONLParser.swift | 252 | Parses Claude JSONL: user/assistant/system messages, tool calls with input summaries |
| RipgrepSearcher.swift | Tempest/History/RipgrepSearcher.swift | 130 | Shells out to `rg --json -i --max-count 3 --glob *.jsonl` |
| HistoryViewerView.swift | Tempest/History/HistoryViewerView.swift | ~100 | Main view with session list + message stream |
| SessionListView.swift | Tempest/History/SessionListView.swift | ~80 | Scrollable session list with metadata |
| MessageStreamView.swift | Tempest/History/MessageStreamView.swift | ~150 | Message display with search highlighting |
| ToolCallView.swift | Tempest/History/ToolCallView.swift | ~50 | Tool call badge with expandable input |

**Key implementation details:**

*HistoryMetadataCache (lines 1-270):*
- Scans `~/.claude/projects/{encoded-path}/` for `.jsonl` files
- Reads first ~50 lines (262KB limit) per file to extract firstPrompt, createdAt, gitBranch
- Cache file: `~/Library/Application Support/Tempest/history-cache.json`
- Invalidation: by mtime/size comparison
- Skips machine-generated messages (those wrapped in `<local-command-caveat>`, `<bash-input>` XML tags)

*JSONLParser (lines 1-252):*
- Line-by-line parsing (not all-at-once)
- Message types: user (extracts `message.content`), assistant (text blocks + tool_use blocks), system
- Skips noise: "queue-operation", "progress", "file-history-snapshot"
- Tool call extraction (lines 106-130): special handling per tool (Bash→command, Read→file_path, Edit→file_path, Skill→skill name)
- Builds searchable text index for ripgrep matching

*RipgrepSearcher (lines 1-130):*
- Command: `rg --json -i --max-count 3 --glob *.jsonl {query} {searchPath}`
- Parses ripgrep JSON output format to extract file paths
- Returns unique, sorted paths

**Implementation approach for Tempest2:**
- Port JSONL parser to TypeScript (straightforward JSON parsing)
- Use `Bun.spawn` for ripgrep execution (same as VCS providers)
- History store runs in Bun process, exposes via RPC
- Message stream view is a React component
- Session list is a React sidebar component

**RPC additions needed:**
```typescript
getHistorySessions: { params: { scope: "all" | "project"; projectPath?: string }; response: SessionSummary[] }
searchHistory: { params: { query: string; scope: "all" | "project"; projectPath?: string }; response: SessionSummary[] }
getSessionMessages: { params: { sessionFilePath: string }; response: SessionMessage[] }
```

**Complexity: MEDIUM — 2-3 days**
- JSONL parsing is straightforward
- ripgrep integration is standard process spawning
- UI is standard React list/detail pattern

---

### Feature 3: PR Feedback System (~1,000 LOC Swift + 199 LOC TypeScript → ~800 LOC TypeScript)

**What it does:** Monitors GitHub PRs for review comments, creates draft replies via Claude Code MCP channel, shows dashboard with draft approval/dismiss.

**Swift source files:**
| File | Path | Lines | What it does |
|------|------|-------|-------------|
| PRSocketServer.swift | Tempest/PRFeedback/PRSocketServer.swift | 405 | HTTP-over-Unix-socket server with SSE streaming |
| PRPoller.swift | Tempest/PRFeedback/PRPoller.swift | 206 | Polls `gh api` for new PR comments, filters resolved threads |
| DraftManager.swift | Tempest/PRFeedback/DraftManager.swift | 47 | Manages draft reply state |
| PRDraft.swift | Tempest/PRFeedback/PRDraft.swift | ~30 | Draft model |
| DashboardView.swift | Tempest/PRFeedback/DashboardView.swift | 102 | Dashboard UI with draft cards |
| DraftCardView.swift | Tempest/PRFeedback/DraftCardView.swift | ~80 | Individual draft card (approve/dismiss) |
| ChannelSettingsBuilder.swift | Tempest/PRFeedback/ChannelSettingsBuilder.swift | 72 | MCP server config for channel.ts |
| PRMonitorState.swift | Tempest/PRFeedback/PRMonitorState.swift | 26 | Monitor state model |

**TempestChannel (already TypeScript!):**
| File | Path | Lines | What it does |
|------|------|-------|-------------|
| channel.ts | TempestChannel/channel.ts | 199 | MCP server: receives SSE events, exposes `submit_draft` tool |

**Key implementation details:**

*PRSocketServer (lines 1-405):*
- Unix socket at `~/.tempest/pr-channel.sock`
- Routes:
  - `GET /workspace/{name}/events` → SSE stream (keeps socket open, sends review comment events)
  - `POST /workspace/{name}/draft` → receives draft submissions from Claude
- SSE format: `event: {type}\ndata: {json}\n\n`
- Tracks SSE clients per workspace, cleans up dead FDs on write failure

*PRPoller (lines 1-206):*
- Polls `gh api repos/{owner/repo}/pulls/{prNumber}/comments --paginate` every 60 seconds
- Filters: own comments, resolved threads (via GraphQL), already-seen (by nodeID)
- GraphQL query for resolved threads: `pullRequest.reviewThreads.nodes[].isResolved` + comment nodeIDs

*Channel.ts (lines 1-199):*
- MCP server with `submit_draft` tool (params: node_id, reply_text, has_code_change, commit_description?, commit_ref?)
- SSE listener: `GET /workspace/{name}/events HTTP/1.1` over Unix socket
- Forwards events as MCP `notifications/claude/channel`
- System instructions tell Claude how to respond to review comments
- Auto-reconnects on disconnect (5 second delay)

**Implementation approach for Tempest2:**
- Port PRSocketServer to Bun using `Bun.listen` for Unix socket + manual HTTP/SSE parsing
- Port PRPoller to use `Bun.spawn` with `gh` CLI (same pattern as VCS)
- Dashboard UI as React component
- Channel.ts can be carried over nearly as-is (already TypeScript!)
- ChannelSettingsBuilder already exists in Tempest2 (`src/bun/hooks/hook-settings-builder.ts`) — extend it

**Complexity: HIGH — 3-4 days**
- Unix socket HTTP server is the hardest part (HTTP parsing, SSE streaming, client lifecycle)
- GitHub API polling with GraphQL is moderately complex
- Channel MCP server is already TypeScript

---

### Feature 4: Markdown Viewer (~350 LOC Swift → ~250 LOC TypeScript)

**What it does:** Renders markdown files with syntax highlighting, mermaid diagrams, and live file watching.

**Swift source files:**
| File | Path | Lines | What it does |
|------|------|-------|-------------|
| MarkdownHTMLBuilder.swift | Tempest/MarkdownViewer/MarkdownHTMLBuilder.swift | 220 | HTML template with markdown-it + highlight.js + mermaid |
| MarkdownFileWatcher.swift | Tempest/MarkdownViewer/MarkdownFileWatcher.swift | 52 | DispatchSourceFileSystemObject for file changes |
| MarkdownWebView.swift | Tempest/MarkdownViewer/MarkdownWebView.swift | 66 | WKWebView wrapper with annotation bridge |
| MarkdownViewerView.swift | Tempest/MarkdownViewer/MarkdownViewerView.swift | ~30 | SwiftUI coordinator |

**Bundled JS libraries:**
- `markdown-it.min.js` (121K) — at `Tempest/MarkdownViewer/Resources/`
- `mermaid.min.js` (2.8M) — at `Tempest/MarkdownViewer/Resources/`
- `highlight.min.js` (119K) — shared resource

**Implementation approach for Tempest2:**
- Use npm: `bun add markdown-it highlight.js mermaid`
- Render in a native `<electrobun-webview renderer="native">` (lightweight, no CEF needed)
- Build HTML template in Bun process, load into webview
- File watching via `Bun.file().watch()` or `fs.watch()`
- Annotation bridge via webview postMessage

**Key details from MarkdownHTMLBuilder.swift:**
- markdown-it config (line 151): `{ html: true, linkify: true, typographer: true }`
- Custom highlight function uses hljs with language detection
- Mermaid: detects `<pre><code class="language-mermaid">` → replaces with `<div class="mermaid">` → calls `mermaid.run()`
- Light/dark mode CSS via `@media (prefers-color-scheme: dark)` with Catppuccin colors
- Escapes backticks, backslashes, dollar signs in markdown content

**Complexity: LOW-MEDIUM — 2-3 days**

---

### Feature 5: Onboarding (~124 LOC Swift → ~100 LOC TypeScript)

**What it does:** First-launch setup: workspace root selection, binary availability checks (git, jj, claude, gh), Get Started button.

**Swift source:** `Tempest/Views/OnboardingSheet.swift` (124 lines)

**Implementation approach:**
- React modal dialog on first launch (when ~/.config/tempest/config.json doesn't exist)
- Binary checks via RPC calling PathResolver
- Workspace root input with browse button (Electrobun may support native file dialogs)
- Save config on completion

**Complexity: LOW — 1 day**

---

### Feature 6: Usage Tracking (~174 LOC Swift → ~150 LOC TypeScript)

**What it does:** Token usage dashboard showing daily counts and costs from ccusage.

**Swift source:** `Tempest/Models/UsageService.swift` (174 lines)

**Key details:**
- Command: `npx ccusage@latest daily --json --since {date} --instances`
- Parses JSON: `inputTokens`, `outputTokens`, `cacheReadTokens`, `totalCost`
- Per-project breakdowns available
- Auto-refresh every 5 minutes

**Implementation approach:**
- Bun service: `Bun.spawn` to run ccusage (or import ccusage directly since it's npm)
- RPC: `getUsageData` → returns daily stats
- React component: usage footer or dashboard panel

**Complexity: LOW — 1 day**

---

### Feature 7: TempestHook Binary (~65 LOC Swift → Bun script)

**What it does:** Invisible hook binary called by Claude Code on session events. Reads stdin JSON, injects pid + event_type, sends to Unix socket.

**Swift source:** `TempestHook/main.swift` (65 lines)

**Implementation approach:**
- Rewrite as a small Bun script (~30 lines) instead of compiled binary
- Reads stdin, parses JSON, injects `event_type` (argv[1]) and `pid` (ppid)
- Connects to Unix socket (argv[2]), writes JSON, exits
- Bundle in app Resources, invoke via `bun /path/to/tempest-hook.ts`

**Key detail from Swift source (lines 41-62):**
- Creates AF_UNIX SOCK_STREAM socket
- Connects to socket path from CLI arg
- Writes JSON + newline
- Always exits 0 (never blocks Claude)

**Complexity: VERY LOW — 0.5 days**

---

### Feature 8: TempestChannel MCP Server (already TypeScript — 199 LOC)

**What it does:** MCP server running in Claude Code that receives PR review comments via SSE and exposes `submit_draft` tool.

**Source:** `TempestChannel/channel.ts` (199 lines) — **can be copied nearly as-is**

**Changes needed:**
- Update socket path resolution
- Bundle in app Resources
- Update ChannelSettingsBuilder to point to new location
- Test with Bun runtime (currently uses `#!/usr/bin/env bun`)

**Complexity: VERY LOW — 0.5 days**

---

## Implementation Order (Recommended)

### Wave 1: Quick Wins (2-3 days total)
These can run in parallel:

| Feature | Effort | Dependencies |
|---------|--------|-------------|
| 5. Onboarding | 1 day | None |
| 7. TempestHook binary | 0.5 days | None |
| 8. TempestChannel copy | 0.5 days | None |
| 6. Usage tracking | 1 day | None |

### Wave 2: Content Viewers (5-6 days total)
Can run in parallel:

| Feature | Effort | Dependencies |
|---------|--------|-------------|
| 4. Markdown Viewer | 2-3 days | None |
| 2. History Viewer | 2-3 days | None |

### Wave 3: Complex Features (6-8 days total)
Sequential dependencies:

| Feature | Effort | Dependencies |
|---------|--------|-------------|
| 1. Diff Viewer | 3-4 days | History Viewer (for AI context panel) |
| 3. PR Feedback | 3-4 days | TempestChannel (Feature 8) |

### Wave 4: Polish & Integration (2-3 days)
- Wire diff viewer into pane tab system
- Wire history viewer into pane tab system
- Wire PR dashboard into workspace view mode
- End-to-end testing of all features
- Visual polish pass

## Total Estimated Effort: 15-20 days

With parallel execution (2-3 Claude sessions):
- **Wave 1:** 1 day (4 features in parallel)
- **Wave 2:** 3 days (2 features in parallel)
- **Wave 3:** 4 days (2 features in parallel, or sequential)
- **Wave 4:** 2 days

**Realistic timeline with parallelism: ~10-12 working days**

## Parallelism Strategy

**Stream F:** Onboarding + Usage Tracking + Markdown Viewer (small, independent)
**Stream G:** History Viewer + Diff Viewer (sequential dependency)
**Stream H:** TempestHook + TempestChannel + PR Feedback (sequential dependency)

Each stream can run in its own worktree as we did for Phase 1.

## File Structure for New Features

```
src/bun/
  diff/
    diff-parser.ts           # Port of DiffProvider.swift unified diff parser
    diff-models.ts           # FileDiff, DiffHunk, DiffLine types
  history/
    history-store.ts         # Facade: cache + ripgrep coordination
    metadata-cache.ts        # Session metadata scanning + caching
    jsonl-parser.ts          # JSONL message parsing
    ripgrep-searcher.ts      # ripgrep process execution
  pr/
    pr-socket-server.ts      # HTTP-over-Unix-socket + SSE server
    pr-poller.ts             # GitHub API polling via gh CLI
    draft-manager.ts         # Draft state management
    channel-settings.ts      # MCP server config builder (extend existing)
  usage/
    usage-service.ts         # ccusage integration

src/views/main/
  components/
    diff/
      DiffView.tsx           # Main orchestrator (file tree + diff + AI panel)
      FileTreeView.tsx       # File list with status badges
      DiffHeader.tsx         # Hunk navigation, mode toggle
      DiffWebView.tsx        # Webview wrapper for diff2html rendering
      AIContextPanel.tsx     # Claude's edits: messages + waypoints
    history/
      HistoryViewer.tsx      # Main view (session list + message stream)
      SessionList.tsx        # Session list sidebar
      MessageStream.tsx      # Message display with search
      ToolCallBadge.tsx      # Tool call visualization
    pr/
      PRDashboard.tsx        # Dashboard with draft cards
      DraftCard.tsx          # Approve/dismiss UI
    markdown/
      MarkdownViewer.tsx     # Webview wrapper for markdown rendering
    onboarding/
      OnboardingDialog.tsx   # First-launch setup
    usage/
      UsageFooter.tsx        # Token usage display

  assets/
    diff-viewer.html         # HTML template for diff2html webview
    markdown-viewer.html     # HTML template for markdown rendering
```

## RPC Schema Additions

```typescript
// --- Diff ---
getDiff: { params: { workspacePath: string; scope: DiffScope; contextLines?: number }; response: string }
parseDiff: { params: { rawDiff: string }; response: FileDiff[] }

// --- History ---
getHistorySessions: { params: { scope: "all" | "project"; projectPath?: string }; response: SessionSummary[] }
searchHistory: { params: { query: string; scope: "all" | "project"; projectPath?: string }; response: SessionSummary[] }
getSessionMessages: { params: { sessionFilePath: string }; response: SessionMessage[] }
getAIContextForFile: { params: { filePath: string; scope: "all" | "project"; projectPath?: string }; response: FileAIContext }

// --- PR Feedback ---
startPRMonitor: { params: { workspacePath: string; prNumber: number; prURL: string; owner: string; repo: string }; response: void }
stopPRMonitor: { params: { workspacePath: string }; response: void }
getPRDrafts: { params: { workspacePath: string }; response: PRDraft[] }
approveDraft: { params: { draftId: string }; response: { success: boolean; error?: string } }
dismissDraft: { params: { draftId: string; abandon: boolean }; response: void }

// --- Usage ---
getUsageData: { params: { since?: string }; response: UsageData }

// --- Onboarding ---
checkBinaries: { params: void; response: { git: boolean; jj: boolean; claude: boolean; gh: boolean } }
```

## Known Tempest2 Issues to Fix During Phase 2

1. **Hook binary path** — `src/bun/hooks/hook-settings-builder.ts` line 56: TODO for tempest-hook binary path
2. **File palette action** — `CommandPalette.tsx` line 272: file click is stub (needs editor tab creation)
3. **Native file picker** — `Sidebar.tsx` line 41: handleAddRepo is stub
4. **`any` type casts** — `src/bun/index.ts` uses `(rpc as any).send?.` for push notifications
5. **Tailwind CDN** — Currently loading via CDN script tag; should configure PostCSS build for production
6. **View modes** — Swift app has terminal/dashboard/diff view modes per workspace; Tempest2 only has terminal
