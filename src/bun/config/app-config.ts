import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../shared/ipc-types";
import { TEMPEST_DIR, CONFIG_FILE, REPOS_FILE } from "./paths";

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
    return (await file.json()) as AppConfig;
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
    return (await file.json()) as string[];
  } catch {
    return [];
  }
}

export async function saveRepoPaths(paths: string[]): Promise<void> {
  mkdirSync(TEMPEST_DIR, { recursive: true });
  await Bun.write(REPOS_FILE, JSON.stringify(paths, null, 2));
}
