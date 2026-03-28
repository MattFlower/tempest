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

      // Catppuccin Mocha
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b70",
        selectionForeground: "#cdd6f4",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(new SearchAddon());

    this.terminal.open(container);
    this.initWebGL();
    this.fitAddon.fit();

    this.terminal.onData((data) => this.onInput(data));
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

      // Cmd+V: paste
      if (event.metaKey && event.key === "v") {
        navigator.clipboard.readText().then((text) => {
          this.onInput(text);
        });
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
