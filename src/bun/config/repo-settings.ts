import { mkdirSync } from "node:fs";
import type { RepoSettings } from "../../shared/ipc-types";
import { TEMPEST_DIR, REPO_SETTINGS_FILE } from "./paths";

export async function loadAllRepoSettings(): Promise<Record<string, RepoSettings>> {
  const file = Bun.file(REPO_SETTINGS_FILE);
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
  mkdirSync(TEMPEST_DIR, { recursive: true });
  await Bun.write(REPO_SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
