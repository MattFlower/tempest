# Tempest — Stream C: Browser Tabs (CEF)

## Your Scope
- `src/views/main/components/browser/BrowserPane.tsx` — CEF webview wrapper
- `src/views/main/components/browser/BrowserToolbar.tsx` — Nav toolbar + find bar
- `src/bun/browser/bookmark-manager.ts` — Per-repo bookmark CRUD + JSON persistence

## Do NOT modify (owned by other streams):
- `src/views/main/components/layout/*` (Stream B)
- `src/views/main/components/terminal/*` (Stream A)
- `src/views/main/components/sidebar/*` (Stream E)

## You MAY update:
- `src/bun/index.ts` — Replace Bookmark RPC stubs with real implementations

## CEF Webview Tag API
```tsx
<electrobun-webview id={id} src={url} renderer="cef" style="flex:1; width:100%; min-height:0;" />
```
Methods: `.loadURL()`, `.goBack()`, `.goForward()`, `.reload()`, `.canGoBack()`, `.canGoForward()`, `.findInPage(text, opts)`, `.stopFindInPage()`
Events: `.on('did-navigate', handler)`, `.on('did-commit-navigation', handler)`

## Browser Toolbar (port from Swift)
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Browser/BrowserTabView.swift`
Back/Forward, Reload/Stop, URL bar (Enter to navigate, auto-prefix https://), bookmark star, find bar (Cmd+F, ESC close, prev/next).

## BookmarkManager (port from Swift)
Ref: `~/tempest/workspaces/code-Tempest/research-electron-rewrite/Tempest/Browser/BookmarkManager.swift`
Storage: `~/.config/Tempest/bookmarks/{sha256(repoPath)}.json`. URL normalization. CRUD with version field.

## Use Bun at /Users/mflower/.bun/bin/bun (version 1.3.11)
