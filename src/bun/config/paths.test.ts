import { describe, it, expect } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  it("all paths are under TEMPEST_DIR", async () => {
    // Dynamic import to get the values computed with current env
    const paths = await import("./paths");

    const exports = [
      paths.CONFIG_FILE,
      paths.REPOS_FILE,
      paths.REPO_SETTINGS_FILE,
      paths.BOOKMARKS_DIR,
      paths.SESSION_STATE_FILE,
      paths.CCUSAGE_STATE_FILE,
      paths.HISTORY_CACHE_FILE,
      paths.HOOK_SOCKET,
      paths.PR_CHANNEL_SOCKET,
      paths.WEBPAGE_PREVIEWS_DIR,
    ];

    for (const p of exports) {
      expect(p.startsWith(paths.TEMPEST_DIR)).toBe(true);
    }
  });

  it("defaults to ~/.config/tempest when no env var is set", async () => {
    const paths = await import("./paths");
    // If TEMPEST_CONFIG_DIR is not set, should default to ~/.config/tempest
    if (!process.env.TEMPEST_CONFIG_DIR) {
      expect(paths.TEMPEST_DIR).toBe(join(homedir(), ".config", "tempest"));
    }
  });
});
