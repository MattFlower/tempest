// Tempest Monaco theme — derived from the application's CSS custom properties
// (global.css neutral-grey palette + accent colors) so the editor blends
// seamlessly with the rest of the UI.
import type { editor } from "monaco-editor";

export const TEMPEST_THEME_NAME = "tempest";

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
