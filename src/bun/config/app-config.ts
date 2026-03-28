import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../shared/ipc-types";

const CONFIG_DIR =
  process.env.TEMPEST_CONFIG_DIR ?? join(homedir(), ".config", "tempest");

export const configFilePath = join(CONFIG_DIR, "config.json");
export const reposFilePath = join(CONFIG_DIR, "repos.json");

export function defaultConfig(): AppConfig {
  return {
    workspaceRoot: join(homedir(), "tempest", "workspaces"),
    claudeArgs: ["--dangerously-skip-permissions"],
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const file = Bun.file(configFilePath);
  if (!(await file.exists())) return defaultConfig();
  try {
    return (await file.json()) as AppConfig;
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(configFilePath, JSON.stringify(config, null, 2));
}

export async function loadRepoPaths(): Promise<string[]> {
  const file = Bun.file(reposFilePath);
  if (!(await file.exists())) return [];
  try {
    return (await file.json()) as string[];
  } catch {
    return [];
  }
}

export async function saveRepoPaths(paths: string[]): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(reposFilePath, JSON.stringify(paths, null, 2));
}
