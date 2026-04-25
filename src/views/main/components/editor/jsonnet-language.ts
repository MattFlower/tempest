// Monaco language definition for Jsonnet (https://jsonnet.org).
// Provides a Monarch tokenizer plus language configuration so Monaco can
// highlight `.jsonnet` / `.libsonnet` files using Tempest's existing theme
// token rules (keyword, string, number, comment, operator, ...).

import type { languages } from "monaco-editor";

export const JSONNET_LANGUAGE_ID = "jsonnet";

export const jsonnetLanguageConfiguration: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] },
    { open: "|||", close: "|||", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  indentationRules: {
    increaseIndentPattern: /^.*(\{[^}]*|\[[^\]]*|\([^)]*)$/,
    decreaseIndentPattern: /^\s*[}\])].*$/,
  },
};

const keywords = [
  "assert",
  "else",
  "error",
  "false",
  "for",
  "function",
  "if",
  "import",
  "importstr",
  "importbin",
  "in",
  "local",
  "null",
  "tailstrict",
  "then",
  "self",
  "super",
  "true",
];

// A non-exhaustive list of std library members so common builtins highlight
// as functions. Anything not listed still tokenizes as a normal identifier.
const stdMembers = [
  "abs", "acos", "asciiLower", "asciiUpper", "asin", "assertEqual", "atan",
  "base64", "base64Decode", "base64DecodeBytes", "ceil", "char", "clamp",
  "codepoint", "cos", "count", "deepJoin", "encodeUTF8", "endsWith", "equals",
  "escapeStringBash", "escapeStringDollars", "escapeStringJson",
  "escapeStringPython", "exp", "exponent", "extVar", "filter", "filterMap",
  "find", "findSubstr", "flatMap", "flattenArrays", "floor", "foldl", "foldr",
  "format", "get", "isArray", "isBoolean", "isFunction", "isNumber", "isObject",
  "isString", "join", "length", "lines", "log", "manifestIni", "manifestJson",
  "manifestJsonEx", "manifestPython", "manifestPythonVars", "manifestXmlJsonml",
  "manifestYamlDoc", "manifestYamlStream", "map", "mapWithIndex", "mapWithKey",
  "max", "md5", "member", "mergePatch", "min", "mod", "native", "objectFields",
  "objectFieldsAll", "objectHas", "objectHasAll", "objectValues",
  "objectValuesAll", "parseHex", "parseInt", "parseJson", "parseOctal",
  "parseYaml", "pow", "prune", "range", "reverse", "round", "set", "setDiff",
  "setInter", "setMember", "setUnion", "sha1", "sha256", "sha3", "sha512",
  "sign", "sin", "slice", "sort", "split", "splitLimit", "sqrt", "startsWith",
  "stringChars", "strReplace", "substr", "tan", "thisFile", "toString", "trace",
  "trim", "type", "uniq", "xor", "xnor",
];

export const jsonnetMonarchLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".jsonnet",
  ignoreCase: false,

  keywords,
  stdMembers,

  operators: [
    "=", "+", "-", "*", "/", "%", "&", "|", "^", "~",
    "==", "!=", "<", ">", "<=", ">=", "&&", "||", "!",
    "<<", ">>", ":", "::", ":::", "+:", "+::", "+:::",
    ".", "?", "$",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  escapes: /\\(?:[btnfr\\"'/]|u[0-9A-Fa-f]{4})/,

  tokenizer: {
    root: [
      // Hash-style comments are allowed in Jsonnet.
      [/#.*$/, "comment"],

      // Identifiers — match `std.<member>` so well-known builtins highlight as
      // functions rather than plain identifiers.
      [/std(?=\.)/, "variable.predefined"],
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@stdMembers": "support.function",
            "@default": "identifier",
          },
        },
      ],

      // Whitespace + line/block comments.
      { include: "@whitespace" },

      // Triple-quote text blocks: |||\n ... \n||| .
      [/\|\|\|/, { token: "string", next: "@textBlock" }],

      // Verbatim strings: @'...' / @"..." (no escape processing).
      [/@"/, { token: "string", next: "@verbatimDouble" }],
      [/@'/, { token: "string", next: "@verbatimSingle" }],

      // Regular strings.
      [/"/, { token: "string", next: "@stringDouble" }],
      [/'/, { token: "string", next: "@stringSingle" }],

      // Numbers (Jsonnet has no hex / octal literals — only decimal, optional
      // fraction, optional exponent).
      [/\d+\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/\d+[eE][\-+]?\d+/, "number.float"],
      [/\d+/, "number"],

      // Delimiters / operators.
      [/[{}()\[\]]/, "@brackets"],
      [/[,;.]/, "delimiter"],
      [
        /@symbols/,
        {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        },
      ],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*/, { token: "comment", next: "@blockComment" }],
      [/\/\/.*$/, "comment"],
    ],

    blockComment: [
      [/[^/*]+/, "comment"],
      [/\*\//, { token: "comment", next: "@pop" }],
      [/[/*]/, "comment"],
    ],

    stringDouble: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string", next: "@pop" }],
    ],

    stringSingle: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, { token: "string", next: "@pop" }],
    ],

    verbatimDouble: [
      [/[^"]+/, "string"],
      [/""/, "string"],
      [/"/, { token: "string", next: "@pop" }],
    ],

    verbatimSingle: [
      [/[^']+/, "string"],
      [/''/, "string"],
      [/'/, { token: "string", next: "@pop" }],
    ],

    textBlock: [
      [/\|\|\|/, { token: "string", next: "@pop" }],
      [/[^|]+/, "string"],
      [/\|/, "string"],
    ],
  },
};
