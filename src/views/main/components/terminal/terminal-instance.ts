import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";

export class TerminalInstance {
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  private webglAddon: WebglAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: number | null = null;

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
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(new SearchAddon());

    this.terminal.open(container);
    this.initWebGL();
    this.fitAddon.fit();

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

    // Track keys handled by our custom handler so we can suppress duplicate
    // data from onData (Electrobun WebView may not fully respect preventDefault).
    let suppressNextData: string | null = null;

    this.terminal.onData((data) => {
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

    // Handle paste via DOM event instead of navigator.clipboard.readText()
    // to avoid WKWebView's paste confirmation popup.
    this.terminal.textarea?.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text");
      if (text) this.onInput(text);
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
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeDebounceTimer !== null) {
        clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        const rect = this.container.getBoundingClientRect();
        if (rect.width >= 50 && rect.height >= 50) {
          this.fitAddon.fit();
        }
      }, 16);
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

  dispose() {
    if (this.resizeDebounceTimer !== null) {
      clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeObserver?.disconnect();
    this.webglAddon?.dispose();
    this.terminal.dispose();
  }
}
