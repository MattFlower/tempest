# Tempest — Stream B: Pane Layout System

## Your Scope (MOST COMPLEX STREAM)
- `src/views/main/models/pane-node.ts` — Complete immutable tree operations (stubs exist)
- `src/views/main/components/layout/PaneTreeView.tsx` — Recursive pane renderer
- `src/views/main/components/layout/PaneView.tsx` — Single pane: tab bar + content
- `src/views/main/components/layout/PaneDivider.tsx` — Draggable divider
- `src/views/main/components/layout/TabBar.tsx` — Scrollable tabs with drag/drop
- `src/views/main/components/layout/TabButton.tsx` — Tab with activity indicator
- `src/views/main/state/actions.ts` — splitPane, addTab, closeTab, moveTab, focusPane, etc.

## Do NOT modify (owned by other streams):
- `src/bun/*` (Streams A, D)
- `src/views/main/components/terminal/*` (Stream A)
- `src/views/main/components/browser/*` (Stream C)
- `src/views/main/components/sidebar/*` (Stream E)

## You MAY update:
- `src/views/main/App.tsx` — Replace "Workspace Detail" placeholder with PaneTreeView
- `src/views/main/state/store.ts` — Add pane state/actions
- `src/views/main/models/*` — Complete stubs

## PaneNode (port from Swift)
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Models/PaneNode.swift`
```typescript
type PaneNode = { type: 'leaf'; pane: Pane } | { type: 'split'; id: string; children: PaneNode[]; ratios: number[] };
```
All operations return NEW trees: addingPane, removingPane, updatingPane, movingTab, swappingPanes, withRatios.

## CRITICAL: Opacity Pattern
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Views/PaneView.swift`
ALL terminal/browser tabs rendered simultaneously. Hidden = `opacity-0 pointer-events-none`. NEVER conditional render. Unmounting destroys xterm.js.

## Normalize Leaf/Split Boundary
Always render via children array (wrap leaf in [node]). Prevents React destroy/recreate at 1↔2 transition.

## Maximize: target full width, others width=0 opacity=0. Dividers hidden. Panes stay in tree.

## Tab Drag/Drop: HTML DnD API with PaneTabDragData payload.

## WorkspaceDetailView Logic
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Views/WorkspaceDetailView.swift` (1892 LOC)
Port to `state/actions.ts`: split, focus next/prev, move, resize, maximize.

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
