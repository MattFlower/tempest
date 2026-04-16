// ============================================================
// Usage tracking service — runs ccusage to get token counts.
//
// Always runs `ccusage@latest` with live pricing. A prior version
// cached pricing with -O/offline mode, but ccusage's offline pricing
// table disagrees with live prices for claude-opus-4-6, inflating
// daily cost by ~60% on cache-heavy days.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { UsageTokens, UsageResponse } from "../../shared/ipc-types";
import { CCUSAGE_STATE_FILE, TEMPEST_DIR } from "../config/paths";

interface CachedResult {
  data: Omit<UsageResponse, "isStale">;
  fetchedAt: number;
  sinceDate: string;
}

interface PersistedState {
  /** Persisted usage cache so data survives app restarts. */
  cachedResult?: CachedResult | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cached: CachedResult | null = null;
let lastFetchFailed = false;
let fetchInProgress = false;

let stateLoaded = false;

function ensureStateLoaded(): void {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const raw = readFileSync(CCUSAGE_STATE_FILE, "utf-8");
    const state: PersistedState = JSON.parse(raw);
    if (state.cachedResult?.data?.dailyTotals) {
      cached = state.cachedResult;
      console.log(`[usage] restored cached data from disk (fetched ${new Date(cached.fetchedAt).toISOString()})`);
    }
  } catch {
    // No persisted state yet — first run
  }
}

function savePersistedState(): void {
  try {
    const state: PersistedState = { cachedResult: cached };
    mkdirSync(TEMPEST_DIR, { recursive: true });
    writeFileSync(CCUSAGE_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[usage] Failed to persist state:", err);
  }
}

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

async function runCCUsage(since: string): Promise<Omit<UsageResponse, "isStale">> {
  const bunPath = process.execPath;
  const args = [bunPath, "x", "ccusage@latest", "daily", "--json", "--since", since, "--instances"];

  console.log("[usage] running: ccusage@latest");

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("[usage] ccusage timed out after 30s");
    try { proc.kill(); } catch {}
  }, 30_000);

  const outputPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [output, stderr] = await Promise.all([outputPromise, stderrPromise]);
  clearTimeout(timer);

  if (timedOut) {
    await proc.exited;
    if (stderr.trim()) {
      console.error("[usage] ccusage stderr:", summarizeStderr(stderr));
    }
    return { dailyTotals: null, projectBreakdowns: {} };
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    if (stderr.trim()) {
      console.error(`[usage] ccusage failed with exit code ${exitCode}:`, summarizeStderr(stderr));
    } else {
      console.error(`[usage] ccusage failed with exit code ${exitCode}`);
    }
    return { dailyTotals: null, projectBreakdowns: {} };
  }

  return parseResponse(output);
}

function summarizeStderr(stderr: string): string {
  const normalized = stderr.trim().replace(/\s+/g, " ");
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}…` : normalized;
}

/** Parse ccusage JSON response — handles ccusage --instances project arrays. */
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

        let totalIn = 0;
        let totalOut = 0;
        let totalCache = 0;
        let totalCost = 0;
        let hasValidEntry = false;

        for (const entry of entries) {
          const usage = parseUsageDict(entry as Record<string, any>);
          if (!usage) continue;
          hasValidEntry = true;
          totalIn += usage.inputTokens;
          totalOut += usage.outputTokens;
          totalCache += usage.cacheReadTokens;
          totalCost += usage.totalCost;
        }

        if (hasValidEntry) {
          projectBreakdowns[slug] = {
            inputTokens: totalIn,
            outputTokens: totalOut,
            cacheReadTokens: totalCache,
            totalCost: totalCost,
          };
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
  ensureStateLoaded();
  const sinceDate = since ?? todayString();

  // Return fresh cache if date matches
  if (cached && cached.sinceDate === sinceDate && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.data, isStale: false };
  }

  // Trigger background fetch if not already running
  if (!fetchInProgress) {
    fetchInProgress = true;
    runCCUsage(sinceDate)
      .then((data) => {
        if (data.dailyTotals) {
          cached = { data, fetchedAt: Date.now(), sinceDate };
          lastFetchFailed = false;
          savePersistedState();
        } else {
          // ccusage returned empty data (timeout, non-zero exit, parse error).
          // Don't overwrite a good cache with empty results.
          console.warn("[usage] ccusage returned no data, keeping previous cache");
          lastFetchFailed = true;
        }
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
  return { dailyTotals: null, projectBreakdowns: {}, isStale: lastFetchFailed };
}
