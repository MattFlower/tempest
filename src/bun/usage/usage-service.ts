// ============================================================
// Usage tracking service — runs ccusage to get token counts.
// Port of UsageService.swift. Caches results with 5-minute TTL.
// ============================================================

import type { UsageTokens, UsageResponse } from "../../shared/ipc-types";

interface CachedResult {
  data: Omit<UsageResponse, "isStale">;
  fetchedAt: number;
  sinceDate: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cached: CachedResult | null = null;
let lastFetchFailed = false;
let fetchInProgress = false;

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
  const bunPath = Bun.which("bun") ?? "bun";

  const proc = Bun.spawn(
    [bunPath, "x", "ccusage@latest", "daily", "--json", "--since", since, "--instances"],
    { stdout: "pipe", stderr: "pipe" },
  );

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error("[usage] ccusage timed out after 10s");
    try { proc.kill(); } catch {}
  }, 10_000);

  const output = await new Response(proc.stdout).text();
  clearTimeout(timer);

  if (timedOut) {
    await proc.exited; // reap the killed process
    return { dailyTotals: null, projectBreakdowns: {} };
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return { dailyTotals: null, projectBreakdowns: {} };
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
