// ============================================================
// BrowserPane — CEF webview wrapper for browser tabs.
// Port of Tempest/Browser/BrowserWebView.swift + BrowserTabState.swift.
// Wraps <electrobun-webview> with toolbar and find bar.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import type { PaneTab } from "../../models/pane-node";
import { BrowserToolbar, FindBar } from "./BrowserToolbar";

// Electrobun webview element type (CEF-backed custom element)
interface ElectrobunWebview extends HTMLElement {
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  findInPage(text: string, opts?: { forward?: boolean; matchCase?: boolean }): void;
  stopFindInPage(): void;
  on(event: string, handler: (...args: any[]) => void): void;
}

export interface BrowserPaneProps {
  paneId: string;
  tab: PaneTab;
  repoPath: string;
  isFocused: boolean;
}

export function BrowserPane({ paneId, tab, repoPath, isFocused }: BrowserPaneProps) {
  const webviewRef = useRef<ElectrobunWebview | null>(null);
  const webviewId = `browser-${tab.id}`;

  // Navigation state
  const [currentUrl, setCurrentUrl] = useState(tab.browserURL || "");
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Find bar state
  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [findText, setFindText] = useState("");
  const [findHasMatch, setFindHasMatch] = useState(true);

  // Attach webview event listeners
  useEffect(() => {
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
    });

    el.on("did-commit-navigation", (event: any) => {
      const url = extractUrl(event);
      if (url) setCurrentUrl(url);
      updateNavState();
    });

    updateNavState();
  }, [webviewId]);

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

  // Navigation actions — wrapped in try-catch for resilience against
  // webview methods being unavailable during initialization or teardown.
  const navigate = useCallback((url: string) => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      setIsLoading(true);
      el.loadURL(url);
      setCurrentUrl(url);
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
    // CEF doesn't have a direct stop — reload suffices as toggle
    setIsLoading(false);
  }, []);

  // Find actions
  // TODO: CEF doesn't expose match count yet — findHasMatch is always true
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

  return (
    <div className="flex flex-col" style={{ height: "100%", width: "100%" }}>
      <BrowserToolbar
        currentUrl={currentUrl}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        repoPath={repoPath}
        onNavigate={navigate}
        onGoBack={goBack}
        onGoForward={goForward}
        onReload={reload}
        onStop={stop}
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
      <electrobun-webview
        id={webviewId}
        src={tab.browserURL || "about:blank"}
        renderer="cef"
        style={{ flex: 1, width: "100%", minHeight: 0 }}
      />
    </div>
  );
}
