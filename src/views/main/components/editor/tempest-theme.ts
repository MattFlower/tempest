// Tempest Monaco themes — derived from the application's CSS custom properties
// (global.css neutral-grey palette + accent colors) so the editor blends
// seamlessly with the rest of the UI.
import type { editor } from "monaco-editor";

export const TEMPEST_THEME_NAME = "tempest";
export const TEMPEST_LIGHT_THEME_NAME = "tempest-light";

export const tempestTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // -- Base --
    { token: "", foreground: "e5e5e5", background: "2e2e2e" },

    // -- Comments --
    { token: "comment", foreground: "6e6e6e", fontStyle: "italic" },
    { token: "comment.doc", foreground: "8a8a8a", fontStyle: "italic" },

    // -- Keywords & storage --
    { token: "keyword", foreground: "c4a7e7" },
    { token: "keyword.control", foreground: "c4a7e7" },
    { token: "keyword.control.import", foreground: "5aa8cc" },
    { token: "keyword.operator", foreground: "6eb8d4" },
    { token: "storage", foreground: "c4a7e7" },
    { token: "storage.type", foreground: "c4a7e7" },

    // -- Strings --
    { token: "string", foreground: "5ec85e" },
    { token: "string.escape", foreground: "6ec2b8" },
    { token: "string.regexp", foreground: "eb6f92" },

    // -- Numbers & constants --
    { token: "number", foreground: "f6a878" },
    { token: "number.hex", foreground: "f6a878" },
    { token: "constant", foreground: "f6a878" },
    { token: "constant.language", foreground: "f6a878", fontStyle: "italic" },
    { token: "constant.character.escape", foreground: "6ec2b8" },

    // -- Types --
    { token: "type", foreground: "f0d399" },
    { token: "type.identifier", foreground: "f0d399" },
    { token: "entity.name.type", foreground: "f0d399" },
    { token: "support.type", foreground: "f0d399" },
    { token: "support.class", foreground: "f0d399" },

    // -- Functions --
    { token: "entity.name.function", foreground: "4a9eff" },
    { token: "support.function", foreground: "4a9eff" },
    { token: "function", foreground: "4a9eff" },

    // -- Variables --
    { token: "variable", foreground: "e5e5e5" },
    { token: "variable.predefined", foreground: "eb6f92" },
    { token: "variable.parameter", foreground: "e89bac", fontStyle: "italic" },
    { token: "variable.language", foreground: "eb6f92", fontStyle: "italic" },

    // -- Operators & punctuation --
    { token: "operator", foreground: "6eb8d4" },
    { token: "delimiter", foreground: "aaaaaa" },
    { token: "delimiter.bracket", foreground: "aaaaaa" },

    // -- Tags (HTML/XML/JSX) --
    { token: "tag", foreground: "eb6f92" },
    { token: "metatag", foreground: "eb6f92" },
    { token: "tag.id.pug", foreground: "4a9eff" },
    { token: "tag.class.pug", foreground: "4a9eff" },
    { token: "meta.tag", foreground: "eb6f92" },
    { token: "entity.name.tag", foreground: "eb6f92" },

    // -- Attributes --
    { token: "attribute.name", foreground: "f0d399", fontStyle: "italic" },
    { token: "attribute.value", foreground: "5ec85e" },
    { token: "entity.other.attribute-name", foreground: "f0d399", fontStyle: "italic" },

    // -- Markup --
    { token: "markup.heading", foreground: "4a9eff", fontStyle: "bold" },
    { token: "markup.bold", fontStyle: "bold" },
    { token: "markup.italic", fontStyle: "italic" },
    { token: "markup.inserted", foreground: "5ec85e" },
    { token: "markup.deleted", foreground: "eb6f92" },
    { token: "markup.changed", foreground: "f6a878" },
    { token: "markup.inline.raw", foreground: "5ec85e" },

    // -- JSON --
    { token: "string.key.json", foreground: "4a9eff" },
    { token: "string.value.json", foreground: "5ec85e" },

    // -- CSS --
    { token: "attribute.name.css", foreground: "6eb8d4" },
    { token: "attribute.value.css", foreground: "f6a878" },
    { token: "attribute.value.unit.css", foreground: "f6a878" },
    { token: "attribute.value.number.css", foreground: "f6a878" },
    { token: "attribute.value.hex.css", foreground: "f6a878" },

    // -- Preprocessor --
    { token: "meta.preprocessor", foreground: "5aa8cc" },

    // -- Invalid --
    { token: "invalid", foreground: "e5e5e5", background: "eb6f92" },
    { token: "invalid.deprecated", foreground: "e5e5e5", background: "555555" },
  ],
  colors: {
    // -- Editor core --
    "editor.background": "#2e2e2e",
    "editor.foreground": "#e5e5e5",
    "editorCursor.foreground": "#4a9eff",
    "editor.lineHighlightBackground": "#3a3a3a",
    "editor.lineHighlightBorder": "#3a3a3a00",

    // -- Selection --
    "editor.selectionBackground": "#4a9eff44",
    "editor.inactiveSelectionBackground": "#4a9eff22",
    "editor.selectionHighlightBackground": "#4a9eff1a",

    // -- Find matches --
    "editor.findMatchBackground": "#f0d39944",
    "editor.findMatchHighlightBackground": "#f0d39922",

    // -- Line numbers --
    "editorLineNumber.foreground": "#6e6e6e",
    "editorLineNumber.activeForeground": "#e5e5e5",

    // -- Whitespace & indentation --
    "editorWhitespace.foreground": "#48484880",
    "editorIndentGuide.background": "#48484880",
    "editorIndentGuide.activeBackground": "#6e6e6e",

    // -- Bracket matching --
    "editorBracketMatch.background": "#4a9eff22",
    "editorBracketMatch.border": "#4a9eff88",

    // -- Gutter & ruler --
    "editorGutter.background": "#2e2e2e",
    "editorRuler.foreground": "#3a3a3a",

    // -- Widget (autocomplete, hover, etc.) --
    "editorWidget.background": "#2a2a2a",
    "editorWidget.border": "#3a3a3a",
    "editorWidget.foreground": "#e5e5e5",
    "editorSuggestWidget.background": "#2a2a2a",
    "editorSuggestWidget.border": "#3a3a3a",
    "editorSuggestWidget.foreground": "#e5e5e5",
    "editorSuggestWidget.highlightForeground": "#4a9eff",
    "editorSuggestWidget.selectedBackground": "#3a3a3a",
    "editorHoverWidget.background": "#2a2a2a",
    "editorHoverWidget.border": "#3a3a3a",

    // -- Scrollbar --
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#48484866",
    "scrollbarSlider.hoverBackground": "#48484899",
    "scrollbarSlider.activeBackground": "#484848cc",

    // -- Minimap (hidden, but just in case) --
    "minimap.background": "#2e2e2e",

    // -- Overview ruler --
    "editorOverviewRuler.border": "#2e2e2e00",
    "editorOverviewRuler.findMatchForeground": "#f0d39966",
    "editorOverviewRuler.selectionHighlightForeground": "#4a9eff44",

    // -- Diff editor --
    "diffEditor.insertedTextBackground": "#5ec85e38",
    "diffEditor.removedTextBackground": "#eb6f9238",
    "diffEditor.insertedLineBackground": "#5ec85e20",
    "diffEditor.removedLineBackground": "#eb6f9220",

    // -- Peek view --
    "peekView.border": "#4a9eff",
    "peekViewEditor.background": "#2a2a2a",
    "peekViewResult.background": "#2a2a2a",
    "peekViewTitle.background": "#2a2a2a",
    "peekViewEditor.matchHighlightBackground": "#f0d39944",
    "peekViewResult.matchHighlightBackground": "#f0d39944",

    // -- Input (find bar, etc.) --
    "input.background": "#3a3a3a",
    "input.foreground": "#e5e5e5",
    "input.border": "#484848",
    "input.placeholderForeground": "#6e6e6e",
    "inputOption.activeBorder": "#4a9eff",

    // -- Dropdown --
    "dropdown.background": "#2a2a2a",
    "dropdown.border": "#3a3a3a",
    "dropdown.foreground": "#e5e5e5",

    // -- List (autocomplete, file picker) --
    "list.activeSelectionBackground": "#3a3a3a",
    "list.activeSelectionForeground": "#e5e5e5",
    "list.hoverBackground": "#3a3a3a88",
    "list.highlightForeground": "#4a9eff",
    "list.focusBackground": "#3a3a3a",

    // -- Error / warning squiggles --
    "editorError.foreground": "#eb6f92",
    "editorWarning.foreground": "#f0d399",
    "editorInfo.foreground": "#4a9eff",
  },
};

export const tempestLightTheme: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    // -- Base --
    { token: "", foreground: "1a1a1a", background: "f0f0f0" },

    // -- Comments --
    { token: "comment", foreground: "8c8c8c", fontStyle: "italic" },
    { token: "comment.doc", foreground: "777777", fontStyle: "italic" },

    // -- Keywords & storage --
    { token: "keyword", foreground: "8839ef" },
    { token: "keyword.control", foreground: "8839ef" },
    { token: "keyword.control.import", foreground: "1074b5" },
    { token: "keyword.operator", foreground: "0f8ab5" },
    { token: "storage", foreground: "8839ef" },
    { token: "storage.type", foreground: "8839ef" },

    // -- Strings --
    { token: "string", foreground: "2c9e2c" },
    { token: "string.escape", foreground: "179299" },
    { token: "string.regexp", foreground: "d20f39" },

    // -- Numbers & constants --
    { token: "number", foreground: "e06c24" },
    { token: "number.hex", foreground: "e06c24" },
    { token: "constant", foreground: "e06c24" },
    { token: "constant.language", foreground: "e06c24", fontStyle: "italic" },
    { token: "constant.character.escape", foreground: "179299" },

    // -- Types --
    { token: "type", foreground: "d4970b" },
    { token: "type.identifier", foreground: "d4970b" },
    { token: "entity.name.type", foreground: "d4970b" },
    { token: "support.type", foreground: "d4970b" },
    { token: "support.class", foreground: "d4970b" },

    // -- Functions --
    { token: "entity.name.function", foreground: "1a6fdb" },
    { token: "support.function", foreground: "1a6fdb" },
    { token: "function", foreground: "1a6fdb" },

    // -- Variables --
    { token: "variable", foreground: "1a1a1a" },
    { token: "variable.predefined", foreground: "d20f39" },
    { token: "variable.parameter", foreground: "c5354b", fontStyle: "italic" },
    { token: "variable.language", foreground: "d20f39", fontStyle: "italic" },

    // -- Operators & punctuation --
    { token: "operator", foreground: "0f8ab5" },
    { token: "delimiter", foreground: "555555" },
    { token: "delimiter.bracket", foreground: "555555" },

    // -- Tags (HTML/XML/JSX) --
    { token: "tag", foreground: "d20f39" },
    { token: "metatag", foreground: "d20f39" },
    { token: "tag.id.pug", foreground: "1a6fdb" },
    { token: "tag.class.pug", foreground: "1a6fdb" },
    { token: "meta.tag", foreground: "d20f39" },
    { token: "entity.name.tag", foreground: "d20f39" },

    // -- Attributes --
    { token: "attribute.name", foreground: "d4970b", fontStyle: "italic" },
    { token: "attribute.value", foreground: "2c9e2c" },
    { token: "entity.other.attribute-name", foreground: "d4970b", fontStyle: "italic" },

    // -- Markup --
    { token: "markup.heading", foreground: "1a6fdb", fontStyle: "bold" },
    { token: "markup.bold", fontStyle: "bold" },
    { token: "markup.italic", fontStyle: "italic" },
    { token: "markup.inserted", foreground: "2c9e2c" },
    { token: "markup.deleted", foreground: "d20f39" },
    { token: "markup.changed", foreground: "e06c24" },
    { token: "markup.inline.raw", foreground: "2c9e2c" },

    // -- JSON --
    { token: "string.key.json", foreground: "1a6fdb" },
    { token: "string.value.json", foreground: "2c9e2c" },

    // -- CSS --
    { token: "attribute.name.css", foreground: "0f8ab5" },
    { token: "attribute.value.css", foreground: "e06c24" },
    { token: "attribute.value.unit.css", foreground: "e06c24" },
    { token: "attribute.value.number.css", foreground: "e06c24" },
    { token: "attribute.value.hex.css", foreground: "e06c24" },

    // -- Preprocessor --
    { token: "meta.preprocessor", foreground: "1074b5" },

    // -- Invalid --
    { token: "invalid", foreground: "f0f0f0", background: "d20f39" },
    { token: "invalid.deprecated", foreground: "1a1a1a", background: "b8b8b8" },
  ],
  colors: {
    // -- Editor core --
    "editor.background": "#f0f0f0",
    "editor.foreground": "#1a1a1a",
    "editorCursor.foreground": "#1a6fdb",
    "editor.lineHighlightBackground": "#e5e5e5",
    "editor.lineHighlightBorder": "#e5e5e500",

    // -- Selection --
    "editor.selectionBackground": "#1a6fdb33",
    "editor.inactiveSelectionBackground": "#1a6fdb1a",
    "editor.selectionHighlightBackground": "#1a6fdb11",

    // -- Find matches --
    "editor.findMatchBackground": "#d4970b44",
    "editor.findMatchHighlightBackground": "#d4970b22",

    // -- Line numbers --
    "editorLineNumber.foreground": "#8c8c8c",
    "editorLineNumber.activeForeground": "#1a1a1a",

    // -- Whitespace & indentation --
    "editorWhitespace.foreground": "#cccccc80",
    "editorIndentGuide.background": "#cccccc80",
    "editorIndentGuide.activeBackground": "#8c8c8c",

    // -- Bracket matching --
    "editorBracketMatch.background": "#1a6fdb22",
    "editorBracketMatch.border": "#1a6fdb88",

    // -- Gutter & ruler --
    "editorGutter.background": "#f0f0f0",
    "editorRuler.foreground": "#dfdfdf",

    // -- Widget (autocomplete, hover, etc.) --
    "editorWidget.background": "#e5e5e5",
    "editorWidget.border": "#dfdfdf",
    "editorWidget.foreground": "#1a1a1a",
    "editorSuggestWidget.background": "#e5e5e5",
    "editorSuggestWidget.border": "#dfdfdf",
    "editorSuggestWidget.foreground": "#1a1a1a",
    "editorSuggestWidget.highlightForeground": "#1a6fdb",
    "editorSuggestWidget.selectedBackground": "#dfdfdf",
    "editorHoverWidget.background": "#e5e5e5",
    "editorHoverWidget.border": "#dfdfdf",

    // -- Scrollbar --
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#cccccc66",
    "scrollbarSlider.hoverBackground": "#cccccc99",
    "scrollbarSlider.activeBackground": "#cccccccc",

    // -- Minimap --
    "minimap.background": "#f0f0f0",

    // -- Overview ruler --
    "editorOverviewRuler.border": "#f0f0f000",
    "editorOverviewRuler.findMatchForeground": "#d4970b66",
    "editorOverviewRuler.selectionHighlightForeground": "#1a6fdb44",

    // -- Diff editor --
    "diffEditor.insertedTextBackground": "#2c9e2c28",
    "diffEditor.removedTextBackground": "#d20f3928",
    "diffEditor.insertedLineBackground": "#2c9e2c15",
    "diffEditor.removedLineBackground": "#d20f3915",

    // -- Peek view --
    "peekView.border": "#1a6fdb",
    "peekViewEditor.background": "#e5e5e5",
    "peekViewResult.background": "#e5e5e5",
    "peekViewTitle.background": "#e5e5e5",
    "peekViewEditor.matchHighlightBackground": "#d4970b44",
    "peekViewResult.matchHighlightBackground": "#d4970b44",

    // -- Input (find bar, etc.) --
    "input.background": "#dfdfdf",
    "input.foreground": "#1a1a1a",
    "input.border": "#cccccc",
    "input.placeholderForeground": "#8c8c8c",
    "inputOption.activeBorder": "#1a6fdb",

    // -- Dropdown --
    "dropdown.background": "#e5e5e5",
    "dropdown.border": "#dfdfdf",
    "dropdown.foreground": "#1a1a1a",

    // -- List (autocomplete, file picker) --
    "list.activeSelectionBackground": "#dfdfdf",
    "list.activeSelectionForeground": "#1a1a1a",
    "list.hoverBackground": "#dfdfdf88",
    "list.highlightForeground": "#1a6fdb",
    "list.focusBackground": "#dfdfdf",

    // -- Error / warning squiggles --
    "editorError.foreground": "#d20f39",
    "editorWarning.foreground": "#d4970b",
    "editorInfo.foreground": "#1a6fdb",
  },
};
