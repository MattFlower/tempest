import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of all Tempest application data.
 * Override with TEMPEST_CONFIG_DIR for testing or custom installations.
 */
export const TEMPEST_DIR =
  process.env.TEMPEST_CONFIG_DIR ?? join(homedir(), ".config", "tempest");

// Config files
export const CONFIG_FILE = join(TEMPEST_DIR, "config.json");
export const REPOS_FILE = join(TEMPEST_DIR, "repos.json");
export const REPO_SETTINGS_FILE = join(TEMPEST_DIR, "repo-settings.json");

// Bookmarks
export const BOOKMARKS_DIR = join(TEMPEST_DIR, "bookmarks");

// Session / UI state
export const SESSION_STATE_FILE = join(TEMPEST_DIR, "session-state.json");

// Usage cache
export const CCUSAGE_STATE_FILE = join(TEMPEST_DIR, "ccusage-state.json");

// History cache
export const HISTORY_CACHE_FILE = join(TEMPEST_DIR, "history-cache.json");

// Progress view cache
export const PROGRESS_CACHE_FILE = join(TEMPEST_DIR, "progress-cache.json");

// Runtime sockets
export const HOOK_SOCKET = join(TEMPEST_DIR, "hook.sock");
export const PR_CHANNEL_SOCKET = join(TEMPEST_DIR, "pr-channel.sock");

// Webpage previews
export const WEBPAGE_PREVIEWS_DIR = join(TEMPEST_DIR, "webpage-previews");
