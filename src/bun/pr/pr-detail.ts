// ============================================================
// PR Detail — Fetches rich PR data for the Progress view.
// Uses `gh pr view --json` for basic fields and GraphQL for
// review thread resolution status.
//
// Two-layer cache: in-memory (60s TTL) + disk persistence
// (~/.config/tempest/progress-cache.json) so data survives
// restarts and the Progress view loads instantly.
// ============================================================

import { mkdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { PathResolver } from "../config/path-resolver";
import { parseGitHubRemote } from "./pr-url-lookup";
import { PROGRESS_CACHE_FILE } from "../config/paths";
import type { PRDetailInfo } from "../../shared/ipc-types";

const pathResolver = new PathResolver();

// --- In-memory cache (fast path) ---
const memCache = new Map<string, { data: PRDetailInfo; timestamp: number }>();
const MEM_TTL_MS = 60_000;

// --- Disk cache ---
interface WorkspaceMeta {
  createdAt?: string;
  lastOpenedAt?: string;
}

interface DiskCache {
  version: 1;
  entries: Record<string, { data: PRDetailInfo; timestamp: number }>;
  workspaceMeta?: Record<string, WorkspaceMeta>;
}

let diskCache: DiskCache | null = null;
let diskDirty = false;

function loadDiskCache(): DiskCache {
  if (diskCache) return diskCache;
  try {
    const raw = JSON.parse(readFileSync(PROGRESS_CACHE_FILE, "utf-8"));
    if (raw?.version === 1 && raw.entries) {
      diskCache = raw as DiskCache;
      if (!diskCache.workspaceMeta) diskCache.workspaceMeta = {};
      // Populate memory cache from disk on cold start
      for (const [key, entry] of Object.entries(diskCache.entries)) {
        memCache.set(key, entry);
      }
      return diskCache;
    }
  } catch {
    // File doesn't exist or is malformed
  }
  diskCache = { version: 1, entries: {}, workspaceMeta: {} };
  return diskCache;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function saveDiskCacheDebounced(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!diskDirty || !diskCache) return;
    diskDirty = false;
    try {
      const dir = join(PROGRESS_CACHE_FILE, "..");
      mkdirSync(dir, { recursive: true });
      await Bun.write(PROGRESS_CACHE_FILE, JSON.stringify(diskCache));
    } catch (err) {
      console.error("[pr-detail] Failed to write disk cache:", err);
    }
  }, 2000);
}

function putCache(key: string, data: PRDetailInfo): void {
  const entry = { data, timestamp: Date.now() };
  memCache.set(key, entry);

  const dc = loadDiskCache();
  dc.entries[key] = entry;
  diskDirty = true;
  saveDiskCacheDebounced();
}

// --- Public API ---

/**
 * Get PR detail, returning cached data if available.
 * - In-memory cache hit (< 60s): return immediately
 * - Disk cache hit (< 24h): return immediately (stale but fast)
 * - Otherwise: fetch from GitHub API
 */
/**
 * Clear all in-memory caches so the next getPRDetail call fetches fresh data.
 */
export function clearPRDetailCache(): void {
  memCache.clear();
}

export async function getPRDetail(
  repoPath: string,
  branch: string,
): Promise<PRDetailInfo | null> {
  const cacheKey = `${repoPath}:${branch}`;

  // 1. Check in-memory cache (fresh)
  const mem = memCache.get(cacheKey);
  if (mem && Date.now() - mem.timestamp < MEM_TTL_MS) {
    return mem.data;
  }

  // 2. Check disk cache (stale but usable — return it, but also refresh in background)
  const dc = loadDiskCache();
  const disk = dc.entries[cacheKey];
  if (disk) {
    // Populate mem cache so subsequent calls are fast
    memCache.set(cacheKey, disk);
    // If the disk entry is older than the mem TTL, kick off a background refresh
    if (Date.now() - disk.timestamp > MEM_TTL_MS) {
      fetchAndCache(repoPath, branch, cacheKey).catch(() => {});
    }
    return disk.data;
  }

  // 3. Cold fetch
  return fetchAndCache(repoPath, branch, cacheKey);
}

/**
 * Get cached PR detail without fetching. Returns null if no cache entry exists.
 * Used by getProgressData to avoid blocking on GitHub API calls.
 */
export function getPRDetailCached(
  repoPath: string,
  branch: string,
): PRDetailInfo | null {
  const cacheKey = `${repoPath}:${branch}`;

  const mem = memCache.get(cacheKey);
  if (mem) return mem.data;

  const dc = loadDiskCache();
  const disk = dc.entries[cacheKey];
  if (disk) {
    memCache.set(cacheKey, disk);
    return disk.data;
  }

  return null;
}

// --- Workspace metadata ---

export function getWorkspaceMeta(workspacePath: string): WorkspaceMeta {
  const dc = loadDiskCache();
  return dc.workspaceMeta?.[workspacePath] ?? {};
}

export function setWorkspaceLastOpened(workspacePath: string): void {
  const dc = loadDiskCache();
  if (!dc.workspaceMeta) dc.workspaceMeta = {};
  const existing = dc.workspaceMeta[workspacePath] ?? {};
  dc.workspaceMeta[workspacePath] = {
    ...existing,
    lastOpenedAt: new Date().toISOString(),
  };
  diskDirty = true;
  saveDiskCacheDebounced();
}

export function setWorkspaceCreatedAt(workspacePath: string, createdAt: string): void {
  const dc = loadDiskCache();
  if (!dc.workspaceMeta) dc.workspaceMeta = {};
  const existing = dc.workspaceMeta[workspacePath] ?? {};
  if (!existing.createdAt) {
    dc.workspaceMeta[workspacePath] = { ...existing, createdAt };
    diskDirty = true;
    saveDiskCacheDebounced();
  }
}

/**
 * Get or derive the workspace creation date.
 * Uses cached value if available, otherwise stats the directory.
 */
export async function resolveWorkspaceCreatedAt(workspacePath: string): Promise<string | undefined> {
  const meta = getWorkspaceMeta(workspacePath);
  if (meta.createdAt) return meta.createdAt;
  try {
    const s = await stat(workspacePath);
    const createdAt = s.birthtime.toISOString();
    setWorkspaceCreatedAt(workspacePath, createdAt);
    return createdAt;
  } catch {
    return undefined;
  }
}

// --- Fetch implementation ---

async function fetchAndCache(
  repoPath: string,
  branch: string,
  cacheKey: string,
): Promise<PRDetailInfo | null> {
  let gitPath: string;
  let ghPath: string;
  try {
    gitPath = pathResolver.resolve("git");
    ghPath = pathResolver.resolve("gh");
  } catch {
    return null;
  }

  const remoteProc = Bun.spawn([gitPath, "remote", "get-url", "origin"], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const remoteOut = await new Response(remoteProc.stdout).text();
  await remoteProc.exited;
  if (remoteProc.exitCode !== 0) return null;

  const ownerRepo = parseGitHubRemote(remoteOut);
  if (!ownerRepo) return null;

  const parts = ownerRepo.split("/");
  const owner = parts[0]!;
  const repo = parts[1]!;

  // Fetch PR data via gh pr view --json
  const fields =
    "number,url,state,title,createdAt,mergedAt,isDraft,reviews,statusCheckRollup";
  const ghProc = Bun.spawn(
    [ghPath, "pr", "view", branch, "--repo", ownerRepo, "--json", fields],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
  );
  const ghOut = await new Response(ghProc.stdout).text();
  await ghProc.exited;
  if (ghProc.exitCode !== 0) return null;

  let raw: any;
  try {
    raw = JSON.parse(ghOut);
  } catch {
    return null;
  }

  // Fetch review thread resolution via GraphQL
  const commentCounts = await fetchCommentCounts(ghPath, owner, repo, raw.number);

  // Transform and cache
  const result = transformPRResponse(raw, commentCounts);
  putCache(cacheKey, result);
  return result;
}

// --- Comment resolution via GraphQL ---

interface CommentCounts {
  noResponse: number;
  unresolved: number;
  resolved: number;
}

async function fetchCommentCounts(
  ghPath: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CommentCounts> {
  const query = `query {
  repository(owner: "${owner}", name: "${repo}") {
    pullRequest(number: ${prNumber}) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 1) {
            totalCount
            nodes { author { login } }
          }
        }
      }
    }
  }
}`;

  try {
    const proc = Bun.spawn(
      [ghPath, "api", "graphql", "-f", `query=${query}`],
      { cwd: process.env.HOME || "/tmp", stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) return { noResponse: 0, unresolved: 0, resolved: 0 };

    const data = JSON.parse(stdout);
    const threads =
      data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

    let resolved = 0;
    let unresolved = 0;
    let noResponse = 0;

    for (const thread of threads) {
      if (thread.isResolved) {
        resolved++;
      } else if (thread.comments?.totalCount <= 1) {
        noResponse++;
      } else {
        unresolved++;
      }
    }

    return { noResponse, unresolved, resolved };
  } catch {
    return { noResponse: 0, unresolved: 0, resolved: 0 };
  }
}

// --- Transform GitHub response ---

function transformPRResponse(
  raw: any,
  commentCounts: CommentCounts,
): PRDetailInfo {
  let state: PRDetailInfo["state"];
  if (raw.state === "MERGED") {
    state = "merged";
  } else if (raw.state === "CLOSED") {
    state = "closed";
  } else if (raw.isDraft) {
    state = "draft";
  } else {
    state = "open";
  }

  const latestReviews = new Map<string, string>();
  for (const review of raw.reviews ?? []) {
    const author = review.author?.login ?? "unknown";
    const reviewState = review.state;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(reviewState)) {
      latestReviews.set(author, reviewState);
    }
  }

  let approved = 0;
  let changesRequested = 0;
  for (const reviewState of latestReviews.values()) {
    if (reviewState === "APPROVED") approved++;
    else if (reviewState === "CHANGES_REQUESTED") changesRequested++;
  }

  const pending = 0;

  let checksPassed = 0;
  let checksFailed = 0;
  for (const check of raw.statusCheckRollup ?? []) {
    const conclusion = check.conclusion ?? check.status;
    if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
      checksPassed++;
    } else if (
      conclusion === "FAILURE" ||
      conclusion === "ERROR" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "CANCELLED"
    ) {
      checksFailed++;
    }
  }

  return {
    prNumber: raw.number,
    prURL: raw.url,
    state,
    title: raw.title ?? "",
    openedAt: raw.createdAt ?? "",
    mergedAt: raw.mergedAt ?? undefined,
    reviewSummary: { approved, changesRequested, pending },
    comments: commentCounts,
    checksPassed,
    checksFailed,
  };
}
