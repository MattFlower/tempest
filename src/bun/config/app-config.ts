import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AppConfig,
  EditorSaveActionsConfig,
  FormattingConfig,
  HttpServerConfig,
  LanguageFormattingConfig,
  McpToolConfig,
} from "../../shared/ipc-types";
import { TEMPEST_DIR, CONFIG_FILE, REPOS_FILE } from "./paths";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isHttpServerConfig(value: unknown): value is HttpServerConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean"
    && typeof value.port === "number"
    && Number.isFinite(value.port)
    && typeof value.hostname === "string"
    && typeof value.token === "string"
  );
}

function isMcpToolConfig(value: unknown): value is McpToolConfig {
  if (!isRecord(value)) return false;
  // All fields are optional; any present field must be a boolean.
  const keys = ["showWebpage", "showMermaidDiagram", "showMarkdown"] as const;
  return keys.every(
    (k) => value[k] === undefined || typeof value[k] === "boolean",
  );
}

/** Normalize a single LanguageFormattingConfig from disk. Skips
 *  unknown / malformed fields rather than rejecting the whole entry,
 *  so a future field added by a newer version doesn't blow up the
 *  config on the older version. Returns undefined when no field was
 *  recognized — keeps the parent's `languages` map clean. */
function normalizeLanguageFormatting(value: unknown): LanguageFormattingConfig | undefined {
  if (!isRecord(value)) return undefined;
  const out: LanguageFormattingConfig = {};
  if (typeof value.formatOnSave === "boolean") out.formatOnSave = value.formatOnSave;
  if (typeof value.defaultFormatter === "string" && value.defaultFormatter.length > 0) {
    out.defaultFormatter = value.defaultFormatter;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeFormatting(value: unknown): FormattingConfig | undefined {
  if (!isRecord(value)) return undefined;
  const out: FormattingConfig = {};
  if (typeof value.formatOnSave === "boolean") out.formatOnSave = value.formatOnSave;
  if (typeof value.formatOnPaste === "boolean") out.formatOnPaste = value.formatOnPaste;
  if (typeof value.formatOnType === "boolean") out.formatOnType = value.formatOnType;
  if (typeof value.defaultFormatter === "string" && value.defaultFormatter.length > 0) {
    out.defaultFormatter = value.defaultFormatter;
  }
  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0) {
    out.timeoutMs = value.timeoutMs;
  }
  if (isRecord(value.languages)) {
    const langs: Record<string, LanguageFormattingConfig> = {};
    for (const [lang, raw] of Object.entries(value.languages)) {
      const normalized = normalizeLanguageFormatting(raw);
      if (normalized) langs[lang] = normalized;
    }
    if (Object.keys(langs).length > 0) out.languages = langs;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeEditorSaveActions(value: unknown): EditorSaveActionsConfig | undefined {
  if (!isRecord(value)) return undefined;
  const out: EditorSaveActionsConfig = {};
  if (typeof value.trimTrailingWhitespace === "boolean") {
    out.trimTrailingWhitespace = value.trimTrailingWhitespace;
  }
  if (typeof value.insertFinalNewline === "boolean") {
    out.insertFinalNewline = value.insertFinalNewline;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeKeybindings(value: unknown): Record<string, string | null> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string | null> = {};
  for (const [id, stroke] of Object.entries(value)) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (stroke === null) {
      out[id] = null;
    } else if (typeof stroke === "string" && stroke.trim().length > 0) {
      // Lightweight shape check — authoritative parsing lives in the UI's keystroke module.
      // Reject anything that isn't space-separated chords of printable chars.
      if (/^[a-z0-9+\-\[\]\\=`',./;? ]+$/i.test(stroke)) out[id] = stroke;
    }
  }
  return out;
}

export function normalizeConfig(raw: unknown): AppConfig {
  const defaults = defaultConfig();
  if (!isRecord(raw)) return defaults;

  const normalized: AppConfig = { ...defaults };

  if (typeof raw.workspaceRoot === "string" && raw.workspaceRoot.trim().length > 0) {
    normalized.workspaceRoot = raw.workspaceRoot;
  }

  if (isStringArray(raw.claudeArgs)) {
    normalized.claudeArgs = raw.claudeArgs;
  }

  if (typeof raw.jjPath === "string") normalized.jjPath = raw.jjPath;
  if (typeof raw.gitPath === "string") normalized.gitPath = raw.gitPath;
  if (typeof raw.claudePath === "string") normalized.claudePath = raw.claudePath;
  if (typeof raw.ghPath === "string") normalized.ghPath = raw.ghPath;
  if (typeof raw.piPath === "string") normalized.piPath = raw.piPath;
  if (typeof raw.codexPath === "string") normalized.codexPath = raw.codexPath;

  if (isStringArray(raw.piArgs)) {
    normalized.piArgs = raw.piArgs;
  }

  if (isStringArray(raw.codexArgs)) {
    normalized.codexArgs = raw.codexArgs;
  }

  if (isStringArray(raw.piEnvVarNames)) {
    normalized.piEnvVarNames = raw.piEnvVarNames;
  }

  if (isStringArray(raw.codexEnvVarNames)) {
    normalized.codexEnvVarNames = raw.codexEnvVarNames;
  }

  if (typeof raw.editor === "string") normalized.editor = raw.editor;
  if (typeof raw.monacoVimMode === "boolean") normalized.monacoVimMode = raw.monacoVimMode;
  if (raw.theme === "dark" || raw.theme === "light") normalized.theme = raw.theme;

  if (typeof raw.httpDefaultPlanMode === "boolean") {
    normalized.httpDefaultPlanMode = raw.httpDefaultPlanMode;
  }
  if (typeof raw.httpAllowTerminalConnect === "boolean") {
    normalized.httpAllowTerminalConnect = raw.httpAllowTerminalConnect;
  }
  if (typeof raw.httpAllowTerminalWrite === "boolean") {
    normalized.httpAllowTerminalWrite = raw.httpAllowTerminalWrite;
  }

  if (isHttpServerConfig(raw.httpServer)) {
    normalized.httpServer = raw.httpServer;
  }

  if (isMcpToolConfig(raw.mcpTools)) {
    normalized.mcpTools = raw.mcpTools;
  }

  const kb = normalizeKeybindings(raw.keybindings);
  if (kb) normalized.keybindings = kb;

  if (typeof raw.lspDisabled === "boolean") normalized.lspDisabled = raw.lspDisabled;

  const formatting = normalizeFormatting(raw.formatting);
  if (formatting) normalized.formatting = formatting;
  const saveActions = normalizeEditorSaveActions(raw.editorSaveActions);
  if (saveActions) normalized.editorSaveActions = saveActions;

  return normalized;
}

export function normalizeRepoPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

export function defaultConfig(): AppConfig {
  return {
    workspaceRoot: join(homedir(), "tempest", "workspaces"),
    claudeArgs: ["--dangerously-skip-permissions"],
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const file = Bun.file(CONFIG_FILE);
  if (!(await file.exists())) return defaultConfig();
  try {
    return normalizeConfig(await file.json());
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  mkdirSync(TEMPEST_DIR, { recursive: true });
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function loadRepoPaths(): Promise<string[]> {
  const file = Bun.file(REPOS_FILE);
  if (!(await file.exists())) return [];
  try {
    return normalizeRepoPaths(await file.json());
  } catch {
    return [];
  }
}

export async function saveRepoPaths(paths: string[]): Promise<void> {
  mkdirSync(TEMPEST_DIR, { recursive: true });
  await Bun.write(REPOS_FILE, JSON.stringify(paths, null, 2));
}
