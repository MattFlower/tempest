import { useState, useEffect, useCallback } from "react";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import type { UsageTokens, UsageResponse } from "../../../../shared/ipc-types";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Convert workspace path to ccusage project slug: /Users/me/code → -Users-me-code */
function projectSlug(path: string): string {
  return path.replace(/\//g, "-");
}

function relativeTime(from: number): string {
  const seconds = Math.floor((Date.now() - from) / 1000);
  if (seconds < 60) return "Updated just now";
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)}m ago`;
  return `Updated ${Math.floor(seconds / 3600)}h ago`;
}

function UsagePill({ label, data, costColor }: { label: string; data: UsageTokens; costColor: string }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-1 rounded-md"
      style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
    >
      <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.45)" }}>
        {label}
      </span>
      <span className="flex items-center gap-2 text-[11px]" style={{ color: "rgba(255,255,255,0.7)" }}>
        <span>↓{formatTokens(data.inputTokens)}</span>
        <span>↑{formatTokens(data.outputTokens)}</span>
        <span>⟳{formatTokens(data.cacheReadTokens)}</span>
      </span>
      <span className="text-[11px] font-medium" style={{ color: costColor }}>
        ${data.totalCost.toFixed(2)}
      </span>
    </div>
  );
}

export function UsageFooter() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setTick] = useState(0); // force re-render for relative time
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);

  const fetchUsage = useCallback(async () => {
    try {
      const data = await api.getUsageData();
      setUsage(data);
      setLastUpdated(Date.now());
    } catch {
      // RPC transport error — keep showing existing data
    }
  }, []);

  useEffect(() => {
    fetchUsage();

    // Retry quickly at first (data may still be loading in background)
    const quickRetry = setInterval(fetchUsage, 3_000);
    let longInterval: ReturnType<typeof setInterval> | null = null;

    // After 15s, switch to standard 5-minute polling
    const slowDown = setTimeout(() => {
      clearInterval(quickRetry);
      longInterval = setInterval(fetchUsage, REFRESH_INTERVAL_MS);
    }, 15_000);

    return () => {
      clearInterval(quickRetry);
      clearTimeout(slowDown);
      if (longInterval) clearInterval(longInterval);
    };
  }, [fetchUsage]);

  // Update relative time display every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const projectData = selectedWorkspacePath
    ? usage?.projectBreakdowns[projectSlug(selectedWorkspacePath)]
    : undefined;

  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderTop: "1px solid var(--ctp-surface0)",
      }}
    >
      {/* Timestamp */}
      <div className="flex items-center gap-1 text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
        {usage?.isStale && <span style={{ color: "var(--ctp-yellow)", fontSize: "10px" }}>stale</span>}
        {lastUpdated ? relativeTime(lastUpdated) : "Loading..."}
      </div>

      <div className="flex-1" />

      {/* TODAY pill */}
      {usage?.dailyTotals && (
        <UsagePill label="TODAY" data={usage.dailyTotals} costColor="var(--ctp-green)" />
      )}

      {/* PROJECT pill */}
      {projectData && (
        <UsagePill label="PROJECT" data={projectData} costColor="var(--ctp-green)" />
      )}
    </div>
  );
}
