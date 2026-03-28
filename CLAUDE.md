# Tempest — Stream E: Sidebar + Command Palette + App Chrome

## Your Scope
- `src/views/main/App.tsx` — Root layout: sidebar + workspace detail
- `src/views/main/components/sidebar/Sidebar.tsx` — Repo sections + workspace rows
- `src/views/main/components/sidebar/RepoSection.tsx` — Collapsible repo with workspaces
- `src/views/main/components/sidebar/WorkspaceRow.tsx` — Status dot, name, branch, diff stats
- `src/views/main/components/sidebar/SidebarToolbar.tsx` — Add repo button
- `src/views/main/components/palette/CommandPalette.tsx` — Modal overlay, fuzzy search
- `src/views/main/components/palette/fuzzy-match.ts` — Score-based fuzzy matching
- `src/views/main/components/chrome/TitleBar.tsx` — Custom titlebar drag region
- Application menu setup in `src/bun/index.ts`

## Do NOT modify (owned by other streams):
- `src/views/main/components/layout/*` (Stream B)
- `src/views/main/components/terminal/*` (Stream A)
- `src/views/main/components/browser/*` (Stream C)
- `src/bun/pty-manager.ts` (Stream A)
- `src/bun/workspace-manager.ts` (Stream D)

## You MAY update:
- `src/views/main/App.tsx` — YOUR file. Replace placeholders.
- `src/views/main/state/store.ts` — Add sidebar/palette state
- `src/bun/index.ts` — Add ApplicationMenu + listFiles handler

## App Layout
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Views/ContentView.swift`
HStack: sidebar (fixed, collapsible, 180-400px, default 240px) + detail (flex). Draggable divider. Workspace detail = placeholder div for Stream B.

## Sidebar
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Views/SidebarView.swift`
Repo headers (expand/collapse, context menu). Workspace rows (status dot, name, branch, diff stats). Bottom toolbar.

## Command Palette
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Views/CommandPaletteView.swift`
450px wide modal. Modes: commands + files. Fuzzy match with scoring. Keyboard: ↑↓ Enter ESC.

## Titlebar
`titleBarStyle: "hiddenInset"` in electrobun.config.ts. Add `<div className="titlebar-drag h-10">` at top of sidebar. CSS already in global.css.

## Application Menus
Use `ApplicationMenu` from `electrobun/bun`. Standard macOS: Tempest, File, Edit, View, Window.

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
