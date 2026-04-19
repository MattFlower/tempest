// Keystroke parsing, normalization, and display formatting.
//
// Normalized form:
//   - Single chord:   "cmd+shift+p", "cmd+]", "cmd+shift+enter"
//   - Chord sequence: "cmd+k cmd+s"  (space-separated chords)
//   - Modifier order: cmd, ctrl, alt, shift
//   - Key: lowercase letters, bare digits, symbolic names for the rest.

export type Keystroke = string;

const MODIFIERS = ["cmd", "ctrl", "alt", "shift"] as const;
type Modifier = typeof MODIFIERS[number];
const MODIFIER_ORDER: Record<Modifier, number> = { cmd: 0, ctrl: 1, alt: 2, shift: 3 };
const MODIFIER_SET = new Set<string>(MODIFIERS);

const CODE_TO_KEY: Record<string, string> = {
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  Space: "space",
  Backspace: "backspace",
  Delete: "delete",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

const VALID_KEYS = new Set<string>([
  ...Object.values(CODE_TO_KEY),
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

function codeToKey(code: string): string | null {
  if (code.startsWith("Key") && code.length === 4) return code[3]!.toLowerCase();
  if (code.startsWith("Digit") && code.length === 6) return code[5]!;
  if (/^F\d{1,2}$/.test(code)) {
    const n = parseInt(code.slice(1), 10);
    if (n >= 1 && n <= 24) return `f${n}`;
  }
  return CODE_TO_KEY[code] ?? null;
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Meta" || key === "Control" || key === "Alt" || key === "Shift";
}

/** Build a normalized single-chord keystroke from a DOM KeyboardEvent.
 *  Returns null if the event is a bare modifier press or maps to no known key. */
export function keystrokeFromEvent(e: KeyboardEvent): Keystroke | null {
  if (isModifierOnlyKey(e.key)) return null;
  const key = codeToKey(e.code);
  if (!key) return null;
  const mods: Modifier[] = [];
  if (e.metaKey) mods.push("cmd");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return [...mods, key].join("+");
}

function normalizeChord(chord: string): string | null {
  const parts = chord.trim().toLowerCase().split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  if (!VALID_KEYS.has(key)) return null;
  const uniqueMods: Modifier[] = [];
  for (const m of mods) {
    if (!MODIFIER_SET.has(m)) return null;
    if (!uniqueMods.includes(m as Modifier)) uniqueMods.push(m as Modifier);
  }
  uniqueMods.sort((a, b) => MODIFIER_ORDER[a] - MODIFIER_ORDER[b]);
  return [...uniqueMods, key].join("+");
}

/** Parse and normalize a keystroke string into an array of chord segments.
 *  Returns an empty array if any chord is invalid. */
export function parseKeystroke(input: string): string[] {
  if (typeof input !== "string") return [];
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  const chords = trimmed.split(/\s+/);
  const out: string[] = [];
  for (const chord of chords) {
    const normalized = normalizeChord(chord);
    if (!normalized) return [];
    out.push(normalized);
  }
  return out;
}

export function isValidKeystroke(input: string): boolean {
  return parseKeystroke(input).length > 0;
}

const MOD_GLYPH: Record<Modifier, string> = {
  cmd: "\u2318",   // ⌘
  ctrl: "\u2303",  // ⌃
  alt: "\u2325",   // ⌥
  shift: "\u21E7", // ⇧
};

const KEY_GLYPH: Record<string, string> = {
  enter: "\u23CE",     // ⏎
  escape: "esc",
  space: "\u2423",     // ␣
  tab: "\u21E5",       // ⇥
  backspace: "\u232B", // ⌫
  delete: "del",
  left: "\u2190",      // ←
  right: "\u2192",     // →
  up: "\u2191",        // ↑
  down: "\u2193",      // ↓
  home: "home",
  end: "end",
  pageup: "pgup",
  pagedown: "pgdn",
};

function formatChord(chord: string): string {
  const parts = chord.split("+");
  const key = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1) as Modifier[];
  const modStr = mods.map((m) => MOD_GLYPH[m]).join("");
  const keyStr = KEY_GLYPH[key] ?? (key.length === 1 ? key.toUpperCase() : key.toUpperCase());
  return `${modStr}${keyStr}`;
}

/** Produce a display form with ⌘⇧⌥⌃ glyphs. Multi-chord sequences separated by a space. */
export function formatKeystroke(keystroke: string): string {
  const chords = parseKeystroke(keystroke);
  if (chords.length === 0) return "";
  return chords.map(formatChord).join(" ");
}
