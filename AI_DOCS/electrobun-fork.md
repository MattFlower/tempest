# Electrobun fork

Tempest depends on a private fork of Electrobun rather than the published
npm package. This file explains why, what's customized, and how to make
changes that need to land in users' builds.

## Where the fork lives

- Repo: <https://github.com/MattFlower/electrobun>
- Working branch: `auto-mask-overlays`
- Local checkout: `~/code/electrobun`
- Tempest pulls a specific release tarball directly from GitHub. As of
  this writing the pinned version is
  `v1.17.3-beta.11-tempest.1`.

The dependency in `package.json` is a fully-qualified URL, e.g.

```
"electrobun": "https://github.com/MattFlower/electrobun/releases/download/v1.17.3-beta.11-tempest.1/electrobun-1.17.3-beta.11-tempest.1.tgz"
```

`bun install` resolves this exactly like an npm tarball. CI on GitHub
Actions does the same — no postinstall scripts, no vendored binaries
in this repo, no npm publication.

## What the fork adds (relative to upstream `electrobun@^1.16.0`)

Three changes, on top of upstream's `1.17.3-beta.11`:

### 1. `setWindowButtonPosition` API for macOS traffic lights

Upstream PR <https://github.com/blackboardsh/electrobun/pull/294> by
chrisdadev13. Native and TypeScript surface for repositioning the
macOS close/minimise/zoom buttons inside a custom title bar.

- Native: `package/src/native/macos/nativeWrapper.mm` adds a
  `setWindowButtonPosition()` C function plus `applyWindowButtonPosition`
  helper, hooked into resize / fullscreen delegate methods so the
  position survives layout resets.
- TypeScript: `package/src/bun/core/BrowserWindow.ts` and `GpuWindow.ts`
  expose a `setWindowButtonPosition(x, y)` method.
- FFI binding registered in `package/src/bun/proc/native.ts`.

Tempest call site: `src/bun/index.ts` — invokes
`win.setWindowButtonPosition(16, 17)` after `BrowserWindow` creation
to vertically centre the buttons inside the 40px (`h-10`) top bar.

The PR is still open upstream. If/when it merges and ships in a real
release, Tempest can stop carrying this part of the patch.

### 2. Auto-mask feature on `<electrobun-webview>`

Implemented entirely in the preload. New opt-in `auto-mask=""`
attribute: when present, the framework automatically punches mask
holes in the native WKWebView wherever positioned host HTML elements
overlap it, and switches the webview into pointer-events passthrough
when modal-style overlays are open. Replaces the old "hide the entire
browser whenever any popup is open" workaround.

Key files:

- `package/src/bun/preload/webviewTag.ts` — the bulk of the logic.
- `package/src/bun/preload/overlaySync.ts` — the related re-sync fix
  (see #3 below).

Behaviour summary:

- Detects positioned (`absolute`/`fixed`) host elements via a single
  document-wide `MutationObserver`.
- Uses `Element.checkVisibility` so descendants of `opacity-0`
  state-preserving wrappers (Tempest mounts hidden workspaces this
  way) aren't classified as visible.
- For transparent click-catcher wrappers (e.g. `CommandPalette`'s
  `fixed inset-0`), recurses into their visible children to mask
  only the actual popup, not the whole viewport.
- Detects the "modal wrapper" pattern (a positioned element whose
  rect covers the whole webview) and enables passthrough so clicks
  reach the host HTML for click-outside dismissal.
- Detects interactive non-full-viewport popovers (anything
  `pointer-events != none`) and also enables passthrough so e.g.
  dropdown menus' `document.addEventListener("mousedown", ...)`
  outside-click dismissal fires.
- Drops strictly-contained mask rects to avoid the
  `kCAFillRuleEvenOdd` XOR bug on nested overlays.
- Per-element opt-out via `data-electrobun-no-mask`.

Tempest call site: the `<electrobun-webview auto-mask="">` element
in `src/views/main/components/browser/BrowserPane.tsx`. Tempest's
older `overlayCount` / `useOverlay` machinery is intentionally bypassed
in `BrowserPane.tsx`'s `isTrulyVisible` calculation — the comment
there explains why. The pieces of that machinery that remain in the
zustand store are dead code, kept for a follow-up cleanup.

### 3. `OverlaySyncController` re-sync bugfix

Standalone fix to `package/src/bun/preload/overlaySync.ts`. The sync
loop only pushed updates to the native side when the webview's own
bounding rect had changed, so any mask-list change while the webview
itself was stationary (a host popup appearing, for example) never
reached the native side. Now tracks the masks-JSON alongside the rect
and triggers an update when either has changed. Useful even without
auto-mask if any consumer adds mask selectors at runtime.

## How tempest is wired up

- `package.json` declares the fork's tarball URL as the `electrobun`
  dependency. `bun.lock` carries an integrity hash.
- `bun x electrobun dev` and `bun x electrobun build --env=stable`
  work without modification: the fork's `bin/electrobun.cjs` wrapper
  finds the prebuilt `electrobun` binary already in `bin/` (shipped
  inside the tarball) and skips the runtime download. The CLI then
  finds `dist-macos-arm64/` already populated and skips the runtime
  download for those binaries too.
- The patched `libNativeWrapper.dylib` is shipped pre-installed in
  `dist-macos-arm64/` and ad-hoc-signed.

No additional scripts run during `bun install` to make this work.

## When you need to cut a new fork release

You need a new fork release if you change anything Tempest pulls at
runtime. In practice this means changes under any of:

- `package/src/bun/preload/**` — preload scripts (re-bundled into
  `dist/api/bun/preload/.generated/compiled.ts`).
- `package/src/bun/core/**`, `package/src/bun/proc/**`, etc. — the
  TypeScript Tempest imports via `electrobun/bun` and
  `electrobun/view`.
- `package/src/native/macos/nativeWrapper.mm` — recompiled into
  `libNativeWrapper.dylib`.

You do **not** need a new fork release for changes that only affect
the CLI source, the Zig launcher, or fork-internal tooling — Tempest
is using the prebuilt v1.16.0 CLI binary that's bundled into the
tarball, and the runtime never recompiles from the fork's CLI source.

When you do need a release, follow `RELEASING-TEMPEST-FORK.md` in the
fork repo (`~/code/electrobun/RELEASING-TEMPEST-FORK.md`). The runbook
covers version bumping, rebuilding `dist/`, repacking the tarball,
tagging, GitHub release creation, and updating Tempest's
`package.json` URL.

## Known limitations and follow-ups

These are deliberate scope limits, not blockers:

- **WKWebView Web Inspector layout bug.** Right-clicking → Inspect
  Element confines Tempest's rendering to the inspector's old area
  when the inspector closes. Pre-existing Electrobun behaviour.
  Investigation deferred.
- **Drag-dismiss bug in dialogs.** Dragging inside a dialog and
  releasing outside of it dismisses the dialog. The dialog components
  use `onClick` on the backdrop, which fires on mouseup regardless of
  where mousedown happened. Tempest-side fix should switch to
  `onMouseDown` with target comparison.
- **Dead `overlayCount` / `useOverlay` / `pushOverlay` / `popOverlay`
  in zustand store.** Replaced by auto-mask but left in the source
  tree to keep the auto-mask commit focused. Safe to delete in a
  follow-up — search for `pushOverlay` / `popOverlay` callers and
  remove them, then drop the store fields.
- **Fork's full upstream build is broken.** The Zig launcher and
  `bun build --compile` of the CLI both fail in the fork's source
  tree. We sidestep this by shipping blackboardsh's prebuilt v1.16.0
  CLI binary inside our tarball. Fixing the upstream build would let
  us produce CLI/launcher binaries from fork source instead.
- **Only `dist-macos-arm64` is shipped.** Adding `dist-darwin-x64` /
  `dist-win-x64` / `dist-linux-x64` would mean populating those
  directories before `bun pm pack`.

## Cross-references

- Fork commits: `auto-mask-overlays` branch in
  `~/code/electrobun`, three commits — see `git log auto-mask-overlays
  ^main`.
- Release runbook: `~/code/electrobun/RELEASING-TEMPEST-FORK.md`.
- Tempest commits adopting the fork: branch `fix-button-position`,
  three commits stacked on `main`.
- User-facing notes: `CHANGELOG.md` Unreleased entries.
- Upstream PR for the traffic-light feature:
  <https://github.com/blackboardsh/electrobun/pull/294>.
