import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { ProgressAddon } from "@xterm/addon-progress";
import { api } from "../../state/rpc-client";

export class TerminalInstance {
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly serializeAddon: SerializeAddon;
  readonly progressAddon: ProgressAddon;
  private webglAddon: WebglAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;
  private focusListenerCleanup: (() => void) | null = null;
  private _cwd: string | undefined;
  private _promptMarks: { promptLine: number; exitCode: number | undefined }[] = [];
  private _lastNavLine: number = -1; // line we last navigated to, -1 = at bottom
  onCwdChange: ((cwd: string) => void) | null = null;

  constructor(
    readonly id: string,
    readonly container: HTMLElement,
    private onInput: (data: string) => void,
    private onResizeCallback: (cols: number, rows: number) => void,
  ) {
    this.terminal = new Terminal({
      allowTransparency: false,
      smoothScrollDuration: 0,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: "block",

      fontSize: 14,
      fontFamily:
        '"MesloLGS Nerd Font", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      fontWeight: "normal",
      fontWeightBold: "bold",

      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,

      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 1,

      // OSC 8 hyperlinks: open in system browser on click, no confirmation dialog
      linkHandler: {
        activate: (_event: MouseEvent, uri: string) => {
          try {
            const url = new URL(uri);
            if (url.protocol === "http:" || url.protocol === "https:") {
              window.open(uri, "_blank");
            }
          } catch {
            // Invalid URL — ignore
          }
        },
      },

      // Ghostty default palette with neutral gray background
      theme: {
        background: "#242424",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selectionBackground: "#ffffff",
        selectionForeground: "#2e2e2e",
        black: "#1d1f21",
        red: "#cc6666",
        green: "#b5bd68",
        yellow: "#f0c674",
        blue: "#81a2be",
        magenta: "#b294bb",
        cyan: "#8abeb7",
        white: "#c5c8c6",
        brightBlack: "#666666",
        brightRed: "#d54e53",
        brightGreen: "#b9ca4a",
        brightYellow: "#e7c547",
        brightBlue: "#7aa6da",
        brightMagenta: "#c397d8",
        brightCyan: "#70c0b1",
        brightWhite: "#eaeaea",
      },
    });

    this.fitAddon = new FitAddon();
    this.progressAddon = new ProgressAddon();
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(this.progressAddon);

    this.terminal.open(container);
    this.initWebGL();
    this.fitAddon.fit();

    // Focus events (CSI ? 1004 h/l): when an app enables sendFocusMode,
    // report focus gain (CSI I) and loss (CSI O) so Neovim, tmux, etc. can react.
    if (this.terminal.element) {
      const el = this.terminal.element;
      const onFocusIn = () => {
        if (this.terminal.modes.sendFocusMode) this.onInput("\x1b[I");
      };
      const onFocusOut = () => {
        if (this.terminal.modes.sendFocusMode) this.onInput("\x1b[O");
      };
      el.addEventListener("focusin", onFocusIn);
      el.addEventListener("focusout", onFocusOut);
      this.focusListenerCleanup = () => {
        el.removeEventListener("focusin", onFocusIn);
        el.removeEventListener("focusout", onFocusOut);
      };
    }

    // Kitty keyboard protocol negotiation.
    // Apps like Claude Code send CSI ? u to query support; we respond so they
    // know we encode modified keys with CSI u.
    const kittyStack: number[] = [];
    let kittyFlags = 0;
    let respondingToQuery = false;
    try {
      this.terminal.parser.registerCsiHandler(
        { prefix: "?", final: "u" },
        () => {
          if (respondingToQuery) return true;
          respondingToQuery = true;
          console.log(`[${this.id}] kitty query → flags=${kittyFlags}`);
          this.onInput(`\x1b[?${kittyFlags}u`);
          setTimeout(() => (respondingToQuery = false), 50);
          return true;
        },
      );
      this.terminal.parser.registerCsiHandler(
        { prefix: ">", final: "u" },
        (params) => {
          kittyStack.push(kittyFlags);
          kittyFlags = (params[0] as number) || 0;
          console.log(`[${this.id}] kitty push → flags=${kittyFlags}`);
          return true;
        },
      );
      this.terminal.parser.registerCsiHandler(
        { prefix: "<", final: "u" },
        (params) => {
          const count = (params[0] as number) || 1;
          for (let i = 0; i < count && kittyStack.length > 0; i++) {
            kittyFlags = kittyStack.pop()!;
          }
          console.log(`[${this.id}] kitty pop → flags=${kittyFlags}`);
          return true;
        },
      );
      this.terminal.parser.registerCsiHandler(
        { prefix: "=", final: "u" },
        (params) => {
          kittyFlags = (params[0] as number) || 0;
          console.log(`[${this.id}] kitty set → flags=${kittyFlags}`);
          return true;
        },
      );
    } catch (e) {
      console.warn(`[${this.id}] Failed to register kitty protocol handlers:`, e);
    }

    // ─── Consume escape sequences not natively handled by xterm.js ───
    // terminal.parser.registerDcsHandler wraps handlers with an internal Xi
    // class that accumulates DCS data and calls the handler as a FUNCTION
    // (data: string, params: number[]) => boolean. Do NOT pass objects.
    try {
      // OSC 7: Working directory notification — parse CWD from file:// URL
      this.terminal.parser.registerOscHandler(7, (data) => {
        try {
          const urlStr = data.trim();
          if (urlStr.startsWith("file://")) {
            const url = new URL(urlStr);
            this._cwd = decodeURIComponent(url.pathname);
          } else if (urlStr.startsWith("/")) {
            this._cwd = urlStr;
          }
          if (this._cwd) {
            this.onCwdChange?.(this._cwd);
          }
        } catch {
          // Malformed URL — ignore
        }
        return true;
      });

      // OSC 52: Clipboard write — apps like Neovim, tmux use this to copy to clipboard.
      // Format: OSC 52 ; <target> ; <base64-data> ST
      // We only support write (not read/query) for security.
      this.terminal.parser.registerOscHandler(52, (data) => {
        const semi = data.indexOf(";");
        if (semi < 0) return true;
        const payload = data.slice(semi + 1);
        // "?" means query (read clipboard) — deny silently
        if (payload === "?") return true;
        try {
          const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
          const text = new TextDecoder().decode(bytes);
          // Route through Bun backend (pbcopy) — WebView clipboard API
          // requires user gesture which OSC 52 doesn't have.
          api.clipboardWrite(text);
        } catch {
          // Invalid base64 — ignore
        }
        return true;
      });

      // OSC 133: FinalTerm shell integration (prompt/command/output boundaries)
      // Markers: A=prompt start, B=command start (user typing), C=output start, D=command end
      this.terminal.parser.registerOscHandler(133, (data) => {
        if (!data) return true;
        const marker = data[0];
        switch (marker) {
          case "A": {
            // Prompt start — record the cursor line as a prompt boundary
            const line = this.terminal.buffer.active.cursorY + this.terminal.buffer.active.baseY;
            this._promptMarks.push({ promptLine: line, exitCode: undefined });
            // Prune marks that have scrolled out of the buffer
            const minLine = this.terminal.buffer.active.baseY - (this.terminal.options.scrollback ?? 10000);
            while (this._promptMarks.length > 0 && this._promptMarks[0]!.promptLine < minLine) {
              this._promptMarks.shift();
            }
            break;
          }
          case "D": {
            // Command end — capture exit code (format: "D;exitcode")
            const last = this._promptMarks[this._promptMarks.length - 1];
            if (last) {
              const parts = data.split(";");
              const code = parts[1] !== undefined ? parseInt(parts[1], 10) : undefined;
              last.exitCode = Number.isNaN(code!) ? undefined : code;
            }
            break;
          }
          // B and C are consumed but not tracked (no UI yet)
        }
        return true;
      });

      // OSC sequences to silently consume:
      for (const id of [
              // OSC 7 handled above (CWD tracking)
              // OSC 9 handled by ProgressAddon (ConEmu progress sequences)
              // OSC 52 handled above (clipboard write)
              // OSC 133 handled above (shell integration)
        22,   // Set mouse pointer shape
        99,   // Kitty notification protocol
        633,  // VS Code shell integration
        1337, // iTerm2 proprietary (inline images, marks, badges, etc.)
      ]) {
        this.terminal.parser.registerOscHandler(id, () => true);
      }
      // Sixel graphics (DCS q ...) — consume silently
      this.terminal.parser.registerDcsHandler({ final: "q" }, () => true);
      // Set terminfo string (DCS +p ...) — consume silently
      this.terminal.parser.registerDcsHandler(
        { intermediates: "+", final: "p" },
        () => true,
      );

      // XTGETTCAP (DCS +q): apps like neovim query terminal capabilities
      // at startup. We must respond or the TUI freezes waiting.
      // Protocol: request  = DCS +q <hex-cap>[;<hex-cap>...] ST
      //           success  = DCS 1+r <hex-cap>=<hex-value> ST
      //           unknown  = DCS 0+r <hex-cap> ST
      const hexEncode = (s: string) =>
        Array.from(s, (c) => c.charCodeAt(0).toString(16)).join("");
      const xtgettcapValues: Record<string, string> = {
        RGB: "8/8/8",         // 24-bit true color
        Se: "\x1b[2 q",       // reset cursor shape
        Ss: "\x1b[%p1%d q",   // set cursor shape
      };
      this.terminal.parser.registerDcsHandler(
        { intermediates: "+", final: "q" },
        (data: string) => {
          const caps = data.split(";");
          for (const hexName of caps) {
            if (!hexName) continue;
            const name = hexName
              .match(/.{1,2}/g)
              ?.map((h) => String.fromCharCode(parseInt(h, 16)))
              .join("") ?? "";
            const value = xtgettcapValues[name];
            if (value !== undefined) {
              this.onInput(`\x1bP1+r${hexName}=${hexEncode(value)}\x1b\\`);
            } else {
              this.onInput(`\x1bP0+r${hexName}\x1b\\`);
            }
          }
          return true;
        },
      );
    } catch (e) {
      console.warn(`[${this.id}] Failed to register escape sequence handlers:`, e);
    }

    // Track keys handled by our custom handler so we can suppress duplicate
    // data from onData (Electrobun WebView may not fully respect preventDefault).
    let suppressNextData: string | null = null;

    this.terminal.onData((data) => {
      // User typed something — reset prompt navigation position
      this._lastNavLine = -1;
      if (suppressNextData !== null) {
        const expected = suppressNextData;
        suppressNextData = null;
        if (data === expected) {
          console.log(`[${this.id}] suppressed duplicate onData: ${JSON.stringify(data)}`);
          return;
        }
      }
      this.onInput(data);
    });
    this.terminal.onResize(({ cols, rows }) =>
      this.onResizeCallback(cols, rows),
    );

    // CSI u keyboard protocol for modified keys xterm.js doesn't encode.
    // Format: ESC [ <keycode> ; <modifier> u
    // Modifier: 1=none, 2=Shift, 3=Alt, 4=Shift+Alt, 5=Ctrl, 6=Ctrl+Shift, 7=Ctrl+Alt, 8=all
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      // Cmd+C: copy selection
      if (event.metaKey && event.key === "c") {
        if (this.terminal.hasSelection()) {
          navigator.clipboard.writeText(this.terminal.getSelection());
          return false;
        }
      }

      // Cmd+V: let the browser handle it so the 'paste' event fires
      if (event.metaKey && event.key === "v") {
        return false;
      }

      // Cmd+F: let the browser handle it so our search bar opens
      if (event.metaKey && event.key === "f") {
        return false;
      }

      // Cmd+Shift+Up/Down: prompt navigation (OSC 133)
      if (event.metaKey && event.shiftKey && event.key === "ArrowUp") {
        this.scrollToPreviousPrompt();
        return false;
      }
      if (event.metaKey && event.shiftKey && event.key === "ArrowDown") {
        this.scrollToNextPrompt();
        return false;
      }

      // Skip meta (Cmd) — OS shortcuts
      if (event.metaKey) return true;

      // Ctrl+letter (a-z): let xterm.js handle natively (ASCII control codes)
      if (event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (event.code >= "KeyA" && event.code <= "KeyZ") {
          return true;
        }
      }

      // Shift+Enter: CSI u for Claude Code newline
      if (event.shiftKey && event.key === "Enter") {
        suppressNextData = "\r";
        this.onInput("\x1b[13;2u");
        return false;
      }

      // CSI u for Ctrl+non-letter keys (Ctrl+/, Ctrl+;, Ctrl+Shift+key, etc.)
      if (event.ctrlKey) {
        const mod = this.csiModifier(event);
        const code = this.csiKeycode(event);
        if (code !== null) {
          this.onInput(`\x1b[${code};${mod}u`);
          return false;
        }
      }

      return true;
    });

    this.setupResizeObserver();
  }

  private initWebGL() {
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        console.warn(`[${this.id}] WebGL context lost, falling back to DOM`);
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
      this.terminal.loadAddon(this.webglAddon);
    } catch (e) {
      console.warn(`[${this.id}] WebGL init failed, using DOM renderer:`, e);
      this.webglAddon = null;
    }
  }

  private setupResizeObserver() {
    let lastCols = 0;
    let lastRows = 0;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeDebounceTimer !== null) {
        cancelAnimationFrame(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = requestAnimationFrame(() => {
        this.resizeDebounceTimer = null;
        const rect = this.container.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) return;

        const dims = this.fitAddon.proposeDimensions();
        if (!dims) return;
        if (dims.cols === lastCols && dims.rows === lastRows) return;
        lastCols = dims.cols;
        lastRows = dims.rows;
        this.fitAddon.fit();
      });
    });
    this.resizeObserver.observe(this.container);
  }

  private csiModifier(e: KeyboardEvent): number {
    let mod = 1;
    if (e.shiftKey) mod += 1;
    if (e.altKey) mod += 2;
    if (e.ctrlKey) mod += 4;
    return mod;
  }

  private csiKeycode(e: KeyboardEvent): number | null {
    if (e.key.length === 1) {
      return e.key.charCodeAt(0);
    }

    const specialKeys: Record<string, number> = {
      Enter: 13,
      Tab: 9,
      Backspace: 127,
      Escape: 27,
      Insert: 2,
      Delete: 3,
      Home: 1,
      End: 4,
      PageUp: 5,
      PageDown: 6,
      F1: 11,
      F2: 12,
      F3: 13,
      F4: 14,
      F5: 15,
      F6: 17,
      F7: 18,
      F8: 19,
      F9: 20,
      F10: 21,
      F11: 23,
      F12: 24,
    };

    // Arrows: CSI 1;mod X
    if (e.key.startsWith("Arrow")) {
      const arrowCodes: Record<string, string> = {
        ArrowUp: "A",
        ArrowDown: "B",
        ArrowRight: "C",
        ArrowLeft: "D",
      };
      const code = arrowCodes[e.key];
      if (code) {
        const mod = this.csiModifier(e);
        this.onInput(`\x1b[1;${mod}${code}`);
        return null;
      }
    }

    // F-keys and nav keys: CSI code;mod ~
    if (
      e.key.startsWith("F") ||
      ["Insert", "Delete", "Home", "End", "PageUp", "PageDown"].includes(
        e.key,
      )
    ) {
      const code = specialKeys[e.key];
      if (code !== undefined) {
        const mod = this.csiModifier(e);
        this.onInput(`\x1b[${code};${mod}~`);
        return null;
      }
    }

    // Enter, Tab, Backspace, Escape: CSI u
    return specialKeys[e.key] ?? null;
  }

  write(data: string) {
    this.terminal.write(data);
  }

  writeBytes(data: Uint8Array) {
    this.terminal.write(data);
  }

  focus() {
    this.terminal.focus();
  }

  blur() {
    this.terminal.blur();
  }

  fit() {
    this.fitAddon.fit();
  }

  proposeDimensions() {
    return this.fitAddon.proposeDimensions();
  }

  get cwd(): string | undefined {
    return this._cwd;
  }

  get promptMarks(): ReadonlyArray<{ promptLine: number; exitCode: number | undefined }> {
    return this._promptMarks;
  }

  /** Scroll to the previous prompt boundary (Cmd+Shift+Up). */
  scrollToPreviousPrompt(): boolean {
    if (this._promptMarks.length === 0) return false;

    // First navigation starts from the cursor; subsequent ones continue from last position
    const refLine = this._lastNavLine >= 0
      ? this._lastNavLine
      : this.terminal.buffer.active.baseY + this.terminal.buffer.active.cursorY;

    for (let i = this._promptMarks.length - 1; i >= 0; i--) {
      if (this._promptMarks[i]!.promptLine < refLine) {
        this._lastNavLine = this._promptMarks[i]!.promptLine;
        this.terminal.scrollToLine(this._lastNavLine);
        return true;
      }
    }
    return false;
  }

  /** Scroll to the next prompt boundary (Cmd+Shift+Down). */
  scrollToNextPrompt(): boolean {
    if (this._promptMarks.length === 0 || this._lastNavLine < 0) return false;

    for (const mark of this._promptMarks) {
      if (mark.promptLine > this._lastNavLine) {
        this._lastNavLine = mark.promptLine;
        this.terminal.scrollToLine(this._lastNavLine);
        return true;
      }
    }

    // Past the last mark — return to bottom
    this._lastNavLine = -1;
    this.terminal.scrollToBottom();
    return true;
  }

  /** Serialize terminal scrollback buffer (returns ANSI escape sequence string). */
  serializeScrollback(rows: number = 200): string {
    return this.serializeAddon.serialize({ scrollback: rows });
  }

  dispose() {
    if (this.resizeDebounceTimer !== null) {
      cancelAnimationFrame(this.resizeDebounceTimer);
    }
    this.resizeObserver?.disconnect();
    this.focusListenerCleanup?.();
    this.webglAddon?.dispose();
    this.terminal.dispose();
  }
}
