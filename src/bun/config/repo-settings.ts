import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RepoSettings } from "../../shared/ipc-types";

const CONFIG_DIR =
  process.env.TEMPEST_CONFIG_DIR ?? join(homedir(), ".config", "tempest");

const REPO_SETTINGS_PATH = join(CONFIG_DIR, "repo-settings.json");

export async function loadAllRepoSettings(): Promise<Record<string, RepoSettings>> {
  const file = Bun.file(REPO_SETTINGS_PATH);
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as Record<string, RepoSettings>;
  } catch {
    return {};
  }
}

export async function saveAllRepoSettings(
  settings: Record<string, RepoSettings>,
): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(REPO_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
