import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig, HttpServerConfig, McpToolConfig } from "../../shared/ipc-types";
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
  return typeof value.showWebpage === "boolean";
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

  if (isStringArray(raw.piArgs)) {
    normalized.piArgs = raw.piArgs;
  }

  if (isStringArray(raw.piEnvVarNames)) {
    normalized.piEnvVarNames = raw.piEnvVarNames;
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
