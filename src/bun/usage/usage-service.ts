// ============================================================
// Usage tracking service — runs ccusage to get token counts.
// Port of UsageService.swift. Caches results with 5-minute TTL.
//
// Pricing strategy: ccusage hits the pricing API only when run
// without -O. We do a full @latest call (with pricing) once
// every 3 hours, capture the resolved version, then use the
// pinned version + -O for all intermediate fetches.
// ============================================================

import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { UsageTokens, UsageResponse } from "../../shared/ipc-types";

interface CachedResult {
  data: Omit<UsageResponse, "isStale">;
  fetchedAt: number;
  sinceDate: string;
}

interface PersistedState {
  lastPricingFetchAt: number | null;
  pinnedVersion: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRICING_REFRESH_MS = 3 * 60 * 60 * 1000; // 3 hours
const STATE_PATH = join(homedir(), "Library", "Application Support", "Tempest", "ccusage-state.json");

let cached: CachedResult | null = null;
let lastFetchFailed = false;
let fetchInProgress = false;

/** Timestamp of last full @latest call (with pricing API). */
let lastPricingFetchAt: number | null = null;
/** Pinned version discovered from the last @latest call. */
let pinnedVersion: string | null = null;

function loadPersistedState(): void {
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state: PersistedState = JSON.parse(raw);
    if (typeof state.lastPricingFetchAt === "number") lastPricingFetchAt = state.lastPricingFetchAt;
    if (typeof state.pinnedVersion === "string") pinnedVersion = state.pinnedVersion;
    console.log(`[usage] restored state: version=${pinnedVersion}, lastPricing=${lastPricingFetchAt ? new Date(lastPricingFetchAt).toISOString() : "never"}`);
  } catch {
    // No persisted state yet — first run
  }
}

function savePersistedState(): void {
  try {
    const state: PersistedState = { lastPricingFetchAt, pinnedVersion };
    mkdirSync(join(homedir(), "Library", "Application Support", "Tempest"), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[usage] Failed to persist state:", err);
  }
}

// Load on module init
loadPersistedState();

export function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Convert a workspace path to the slug ccusage uses as project key. */
export function projectSlug(from: string): string {
  return from.replace(/\//g, "-");
}

/** Format a token count for compact display: 288, 4.4K, 12.7M */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** Whether it's time for a full @latest call with pricing API. */
function needsPricingRefresh(): boolean {
  if (lastPricingFetchAt === null) return true;
  return Date.now() - lastPricingFetchAt >= PRICING_REFRESH_MS;
}

/** Resolve the current version from a ccusage@latest --version call. */
async function resolveLatestVersion(bunPath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      [bunPath, "x", "ccusage@latest", "--version"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const version = output.trim();
      if (version) return version;
    }
  } catch {}
  return null;
}

async function runCCUsage(since: string): Promise<Omit<UsageResponse, "isStale">> {
  const bunPath = Bun.which("bun") ?? "bun";
  const fullRefresh = needsPricingRefresh();

  // Build the command: @latest for full refresh, @pinnedVersion + -O otherwise
  const pkg = fullRefresh || !pinnedVersion
    ? "ccusage@latest"
    : `ccusage@${pinnedVersion}`;
  const args = [bunPath, "x", pkg, "daily", "--json", "--since", since, "--instances"];
  if (!fullRefresh && pinnedVersion) {
    args.push("-O");
  }

  console.log(`[usage] running: ${pkg}${fullRefresh ? " (full refresh)" : " -O (cached pricing)"}`);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("[usage] ccusage timed out after 30s");
    try { proc.kill(); } catch {}
  }, 30_000);

  const output = await new Response(proc.stdout).text();
  clearTimeout(timer);

  if (timedOut) {
    await proc.exited;
    return { dailyTotals: null, projectBreakdowns: {} };
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return { dailyTotals: null, projectBreakdowns: {} };
  }

  // On successful full refresh, record the timestamp and capture version
  if (fullRefresh) {
    lastPricingFetchAt = Date.now();
    savePersistedState();
    // Resolve version in background — @latest is already cached by bun so this is fast
    resolveLatestVersion(bunPath).then((v) => {
      if (v) {
        console.log(`[usage] pinned ccusage version: ${v}`);
        pinnedVersion = v;
        savePersistedState();
      }
    });
  }

  return parseResponse(output);
}

/** Parse ccusage JSON response — matches Swift UsageService.parseResponse exactly. */
export function parseResponse(raw: string): Omit<UsageResponse, "isStale"> {
  try {
    const json = JSON.parse(raw);

    // Parse totals (from non-instances response)
    let dailyTotals: UsageTokens | null = null;
    if (json.totals && typeof json.totals === "object") {
      dailyTotals = parseUsageDict(json.totals);
    }

    // Parse per-project breakdowns (from --instances response)
    const projectBreakdowns: Record<string, UsageTokens> = {};
    if (json.projects && typeof json.projects === "object") {
      for (const [slug, value] of Object.entries(json.projects)) {
        const entries = value as any[];
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const usage = parseUsageDict(entries[0]);
        if (usage) {
          projectBreakdowns[slug] = usage;
        }
      }
    }

    // Compute daily totals by summing all project breakdowns (matches Swift logic)
    if (Object.keys(projectBreakdowns).length > 0) {
      let totalIn = 0, totalOut = 0, totalCache = 0, totalCost = 0;
      for (const usage of Object.values(projectBreakdowns)) {
        totalIn += usage.inputTokens;
        totalOut += usage.outputTokens;
        totalCache += usage.cacheReadTokens;
        totalCost += usage.totalCost;
      }
      dailyTotals = {
        inputTokens: totalIn,
        outputTokens: totalOut,
        cacheReadTokens: totalCache,
        totalCost: totalCost,
      };
    }

    return { dailyTotals, projectBreakdowns };
  } catch (err) {
    console.error("[usage] Failed to parse ccusage output:", err);
    return { dailyTotals: null, projectBreakdowns: {} };
  }
}

function parseUsageDict(dict: Record<string, any>): UsageTokens | null {
  const input = dict.inputTokens;
  const output = dict.outputTokens;
  const cacheRead = dict.cacheReadTokens;
  const cost = dict.totalCost;
  if (typeof input !== "number" || typeof output !== "number" ||
      typeof cacheRead !== "number" || typeof cost !== "number") {
    return null;
  }
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, totalCost: cost };
}

/** Non-blocking: returns cached data immediately, triggers background fetch if stale. */
export async function getUsageData(since?: string): Promise<UsageResponse> {
  const sinceDate = since ?? todayString();

  // Return fresh cache if date matches
  if (cached && cached.sinceDate === sinceDate && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.data, isStale: false };
  }

  // Trigger background fetch if not already running
  if (!fetchInProgress) {
    fetchInProgress = true;
    lastFetchFailed = false;
    runCCUsage(sinceDate)
      .then((data) => {
        cached = { data, fetchedAt: Date.now(), sinceDate };
        lastFetchFailed = false;
      })
      .catch((err) => {
        console.error("[usage] Background fetch failed:", err);
        lastFetchFailed = true;
      })
      .finally(() => {
        fetchInProgress = false;
      });
  }

  // Return stale cache or empty — never block.
  // Mark as stale when: serving data for a different date, or last fetch failed.
  if (cached) {
    const dateMismatch = cached.sinceDate !== sinceDate;
    return { ...cached.data, isStale: dateMismatch || lastFetchFailed };
  }
  return { dailyTotals: null, projectBreakdowns: {}, isStale: false };
}
