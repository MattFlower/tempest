// ============================================================
// BrowserPane — Electrobun webview wrapper for browser tabs.
// Port of Tempest/Browser/BrowserWebView.swift + BrowserTabState.swift.
// Wraps <electrobun-webview> with toolbar and find bar.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import type { PaneTab } from "../../models/pane-node";
import { findPane } from "../../models/pane-node";
import { useStore } from "../../state/store";
import { ViewMode } from "../../../../shared/ipc-types";
import { BrowserToolbar, FindBar } from "./BrowserToolbar";
import { api } from "../../state/rpc-client";

// Electrobun webview element type (system webview custom element)
interface ElectrobunWebview extends HTMLElement {
  loadURL(url: string): void;
  loadHTML(html: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  findInPage(text: string, opts?: { forward?: boolean; matchCase?: boolean }): void;
  stopFindInPage(): void;
  toggleHidden(value?: boolean): void;
  togglePassthrough(value?: boolean): void;
  executeJavascript(js: string): void;
  on(event: string, handler: (...args: any[]) => void): void;
}

/** Build a self-contained HTML error page for DNS resolution failures. */
function dnsErrorPage(url: string, hostname: string, error: string): string {
  const escapedUrl = url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedHost = hostname.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedError = error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
  }
  .container {
    max-width: 480px;
    text-align: center;
  }
  .icon {
    font-size: 48px;
    margin-bottom: 1.5rem;
    opacity: 0.7;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: #ffffff;
  }
  .hostname {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    background: rgba(255,255,255,0.08);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.95em;
  }
  .detail {
    color: #999;
    font-size: 0.85rem;
    line-height: 1.5;
    margin-bottom: 1.5rem;
  }
  .error-code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    color: #777;
    font-size: 0.75rem;
    margin-top: 1.5rem;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="icon">&#x1F50D;</div>
    <h1>Can\u2019t find <span class="hostname">${escapedHost}</span></h1>
    <p class="detail">
      The server at <strong>${escapedHost}</strong> can\u2019t be found because the
      DNS lookup failed. Check the address for typos, or verify your network connection.
    </p>
    <p class="error-code">${escapedError}<br>${escapedUrl}</p>
  </div>
</body>
</html>`;
}

export interface BrowserPaneProps {
  paneId: string;
  tab: PaneTab;
  repoPath: string;
  isFocused: boolean;
  isVisible: boolean;
}

export function BrowserPane({ paneId, tab, repoPath, isFocused, isVisible }: BrowserPaneProps) {
  const webviewRef = useRef<ElectrobunWebview | null>(null);
  const webviewId = `browser-${tab.id}`;
  // Ref tracks latest visibility for use in async callbacks (avoids stale closures).
  const isTrulyVisibleRef = useRef(false);

  // True visibility: combines hiding layers (tab selection, pane
  // maximization, workspace selection, view mode) so we can tell the native
  // webview overlay to hide — CSS opacity/display have no effect on it.
  //
  // Note: we intentionally do NOT check `overlayCount` here. The native
  // overlay is kept visible while popups/dialogs/palettes are open and the
  // auto-mask system (Electrobun fork) cuts holes where the host HTML popup
  // content lives. The old "hide the whole browser" behavior was a workaround
  // for not having auto-mask and is no longer needed.
  const isTrulyVisible = useStore((s) => {
    if (!isVisible) return false;
    if (s.maximizedPaneId !== null && s.maximizedPaneId !== paneId) return false;
    for (const [wsPath, tree] of Object.entries(s.paneTrees)) {
      if (findPane(tree, paneId)) {
        if (wsPath !== s.selectedWorkspacePath) return false;
        const vm = s.workspaceViewMode[wsPath] ?? ViewMode.Terminal;
        if (vm !== ViewMode.Terminal) return false;
        return true;
      }
    }
    return false;
  });

  isTrulyVisibleRef.current = isTrulyVisible;

  // Defer mounting the <electrobun-webview> element until it has been truly
  // visible at least once. Electrobun's native WKWebView overlay is created in
  // connectedCallback (via rAF → initWebview) and ignores CSS display/opacity,
  // so the only way to prevent the overlay from appearing for non-visible
  // workspaces on startup is to keep the element out of the DOM entirely.
  // Once mounted, the element stays in the DOM and toggleHidden manages
  // subsequent visibility changes.
  const [mounted, setMounted] = useState(isTrulyVisible);
  useEffect(() => {
    if (isTrulyVisible && !mounted) setMounted(true);
  }, [isTrulyVisible, mounted]);

  // Navigation state
  const [currentUrl, setCurrentUrl] = useState(tab.browserURL || "");
  const [pageTitle, setPageTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Find bar state
  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [findText, setFindText] = useState("");
  const [findHasMatch, setFindHasMatch] = useState(true);

  // Hide native webview when a toolbar popover is open (the native WKWebView
  // overlay sits on top of all DOM content, so popovers are invisible otherwise).
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Stable refs for find callbacks so the host-message handler (registered
  // once on mount) always calls the latest version without stale closures.
  const findNextRef = useRef(() => {});
  const findPreviousRef = useRef(() => {});
  const closeFindBarRef = useRef(() => {});

  // Attach webview event listeners once the element is in the DOM.
  useEffect(() => {
    if (!mounted) return;
    const el = document.getElementById(webviewId) as ElectrobunWebview | null;
    if (!el) return;
    webviewRef.current = el;

    const updateNavState = () => {
      try {
        setCanGoBack(el.canGoBack());
        setCanGoForward(el.canGoForward());
      } catch {
        // Methods may not be available yet
      }
    };

    const extractUrl = (event: any): string => {
      // Electrobun CustomEvent: URL might be in various places
      if (typeof event === "string") return event;
      if (event?.detail?.url) return event.detail.url;
      if (typeof event?.detail === "string") return event.detail;
      if (event?.url) return event.url;
      return "";
    };

    el.on("did-navigate", (event: any) => {
      const url = extractUrl(event);
      if (url) setCurrentUrl(url);
      setIsLoading(false);
      updateNavState();
      // Ask the content page to send its title back via host-message,
      // and install a Cmd+F listener so find works even when the native
      // WKWebView overlay has focus (keyboard events don't reach React).
      try {
        el.executeJavascript(
          `if(window.__electrobunSendToHost){` +
            `window.__electrobunSendToHost({type:"page-title",title:document.title});` +
            `if(!window.__tempestFindInstalled){` +
              `window.__tempestFindInstalled=true;` +
              `document.addEventListener("keydown",function(e){` +
                `var m=e.metaKey||e.ctrlKey;` +
                `if(m&&e.key==="f"){e.preventDefault();window.__electrobunSendToHost({type:"find-shortcut"})}` +
                `else if(m&&e.key==="g"){e.preventDefault();window.__electrobunSendToHost({type:e.shiftKey?"find-previous":"find-next"})}` +
                `else if(e.key==="Escape"){window.__electrobunSendToHost({type:"find-close"})}` +
              `},true)` +
            `}` +
          `}`
        );
      } catch {}
    });

    el.on("did-commit-navigation", (event: any) => {
      const url = extractUrl(event);
      if (url) setCurrentUrl(url);
      updateNavState();
    });

    // Intercept window.open / target="_blank" link clicks and load the URL
    // in the current webview instead of spawning a new window. Without this,
    // clicking such links is a silent no-op (common on Google results, news
    // sites, etc.).
    el.on("new-window-open", (event: any) => {
      const url = extractUrl(event);
      if (!url) return;
      // Validate protocol — a compromised/malicious page can trigger
      // new-window-open with javascript:, file://, or other dangerous
      // schemes. Only allow http/https, matching navigate()'s guard.
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      } catch {
        return;
      }
      try {
        setIsLoading(true);
        setCurrentUrl(url);
        el.loadURL(url);
      } catch {
        setIsLoading(false);
      }
    });

    // Listen for host messages from the content page (e.g. page title, find shortcut)
    el.on("host-message", (event: any) => {
      try {
        const raw = event?.detail ?? event;
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (data?.type === "page-title" && typeof data.title === "string") {
          setPageTitle(data.title);
        } else if (data?.type === "find-shortcut") {
          setIsFindBarVisible(true);
        } else if (data?.type === "find-next") {
          findNextRef.current();
        } else if (data?.type === "find-previous") {
          findPreviousRef.current();
        } else if (data?.type === "find-close") {
          closeFindBarRef.current();
        }
      } catch {}
    });

    updateNavState();

    // Guard against the race between React effects and Electrobun's async
    // overlay creation. toggleHidden() is a no-op when called before
    // initWebview sets webviewId (connectedCallback → rAF → initWebview).
    // A double-rAF ensures we re-apply visibility AFTER the overlay exists.
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const visible = isTrulyVisibleRef.current;
        try {
          if (visible) {
            el.style.display = "";
            el.toggleHidden(false);
            el.togglePassthrough(false);
          } else {
            el.toggleHidden(true);
            el.togglePassthrough(true);
            el.style.display = "none";
          }
        } catch {}
      });
    });

    return () => { cancelled = true; };
  }, [webviewId, mounted]);

  // Keyboard shortcut: Cmd+F for find
  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsFindBarVisible(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocused]);

  // Show/hide the native webview overlay when visibility changes or a popover is open.
  // Three layers to work around Electrobun's OverlaySyncController which sends
  // webviewTagResize every 100ms (even when hidden) and can re-activate the
  // overlay on the native side, overriding toggleHidden:
  //   1. toggleHidden — tells native side to hide/show
  //   2. togglePassthrough — prevents click interception even if overlay re-shows
  //   3. display:none — makes getBoundingClientRect() return 0×0, causing the
  //      sync loop to skip resize messages (overlaySync.ts:87-89)
  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      const shouldShow = isTrulyVisible && !popoverOpen;
      if (shouldShow) {
        el.style.display = "";
        el.toggleHidden(false);
        el.togglePassthrough(false);
      } else {
        el.toggleHidden(true);
        el.togglePassthrough(true);
        el.style.display = "none";
      }
    } catch {
      // Methods may not be available during initialization
    }
  }, [isTrulyVisible, popoverOpen]);

  // Navigation actions — wrapped in try-catch for resilience against
  // webview methods being unavailable during initialization or teardown.
  const navigate = useCallback(async (url: string) => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      setIsLoading(true);
      setCurrentUrl(url);

      // Pre-flight DNS check for http/https URLs to catch unresolvable
      // hostnames before handing the URL to WKWebView (which silently
      // does nothing on DNS failure — no error event, no error page).
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const result = await api.resolveDns(parsed.hostname);
          if (!result.ok) {
            el.loadHTML(dnsErrorPage(url, parsed.hostname, result.error ?? "DNS lookup failed"));
            setIsLoading(false);
            return;
          }
        }
      } catch {
        // URL parsing failed — let WKWebView handle it
      }

      el.loadURL(url);
    } catch {
      setIsLoading(false);
    }
  }, []);

  const goBack = useCallback(() => {
    try { webviewRef.current?.goBack(); } catch {}
  }, []);
  const goForward = useCallback(() => {
    try { webviewRef.current?.goForward(); } catch {}
  }, []);
  const reload = useCallback(() => {
    try { webviewRef.current?.reload(); } catch {}
  }, []);
  const stop = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Find actions
  const handleFindTextChange = useCallback((text: string) => {
    setFindText(text);
    const el = webviewRef.current;
    if (!el) return;
    try {
      if (text) {
        el.findInPage(text, { forward: true, matchCase: false });
        setFindHasMatch(true);
      } else {
        el.stopFindInPage();
        setFindHasMatch(true);
      }
    } catch {}
  }, []);

  const findNext = useCallback(() => {
    try { webviewRef.current?.findInPage(findText, { forward: true, matchCase: false }); } catch {}
  }, [findText]);

  const findPrevious = useCallback(() => {
    try { webviewRef.current?.findInPage(findText, { forward: false, matchCase: false }); } catch {}
  }, [findText]);

  const closeFindBar = useCallback(() => {
    setIsFindBarVisible(false);
    setFindText("");
    setFindHasMatch(true);
    try { webviewRef.current?.stopFindInPage(); } catch {}
  }, []);

  // Keep refs in sync with latest callbacks.
  findNextRef.current = findNext;
  findPreviousRef.current = findPrevious;
  closeFindBarRef.current = closeFindBar;

  return (
    <div className="flex flex-col" style={{ height: "100%", width: "100%" }}>
      <BrowserToolbar
        currentUrl={currentUrl}
        pageTitle={pageTitle}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        repoPath={repoPath}
        onNavigate={navigate}
        onGoBack={goBack}
        onGoForward={goForward}
        onReload={reload}
        onStop={stop}
        onPopoverChange={setPopoverOpen}
      />

      {isFindBarVisible && (
        <FindBar
          findText={findText}
          findHasMatch={findHasMatch}
          onFindTextChange={handleFindTextChange}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onClose={closeFindBar}
        />
      )}

      {/* @ts-ignore — electrobun-webview is a custom element */}
      {mounted && (
        <electrobun-webview
          id={webviewId}
          src={tab.browserURL || "about:blank"}
          style={{ flex: 1, width: "100%", minHeight: 0 }}
          auto-mask=""
        />
      )}
    </div>
  );
}
