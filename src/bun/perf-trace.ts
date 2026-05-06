import { existsSync } from "node:fs";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { PerformanceLoggingConfig } from "../shared/ipc-types";
import { PERF_LOG_DIR, PERF_LOG_FILE } from "./config/paths";

const DEFAULT_SLOW_TASK_THRESHOLD_MS = 500;
const DEFAULT_EVENT_LOOP_LAG_THRESHOLD_MS = 200;
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MONITOR_INTERVAL_MS = 1000;

type PerfDetails = Record<string, unknown>;

interface ActiveTask {
  id: number;
  name: string;
  startedAt: number;
  details?: PerfDetails;
}

interface RuntimeConfig {
  enabled: boolean;
  slowTaskThresholdMs: number;
  eventLoopLagThresholdMs: number;
}

class PerfTrace {
  private config: RuntimeConfig = {
    enabled: process.env.TEMPEST_PERF_LOG === "1",
    slowTaskThresholdMs: DEFAULT_SLOW_TASK_THRESHOLD_MS,
    eventLoopLagThresholdMs: DEFAULT_EVENT_LOOP_LAG_THRESHOLD_MS,
  };
  private activeTasks = new Map<number, ActiveTask>();
  private nextTaskId = 1;
  private writeQueue: Promise<void> = Promise.resolve();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private nextExpectedTick = 0;

  configure(config: PerformanceLoggingConfig | undefined): void {
    const nextConfig = {
      enabled: config?.enabled === true || process.env.TEMPEST_PERF_LOG === "1",
      slowTaskThresholdMs:
        config?.slowTaskThresholdMs ?? DEFAULT_SLOW_TASK_THRESHOLD_MS,
      eventLoopLagThresholdMs:
        config?.eventLoopLagThresholdMs ?? DEFAULT_EVENT_LOOP_LAG_THRESHOLD_MS,
    };
    const changed =
      this.config.enabled !== nextConfig.enabled ||
      this.config.slowTaskThresholdMs !== nextConfig.slowTaskThresholdMs ||
      this.config.eventLoopLagThresholdMs !== nextConfig.eventLoopLagThresholdMs;
    this.config = nextConfig;

    if (this.config.enabled) {
      this.startEventLoopMonitor();
      if (changed) {
        void this.log({
          type: "perfLoggingConfigured",
          slowTaskThresholdMs: this.config.slowTaskThresholdMs,
          eventLoopLagThresholdMs: this.config.eventLoopLagThresholdMs,
          logFile: PERF_LOG_FILE,
        });
      }
    } else {
      this.stopEventLoopMonitor();
      this.activeTasks.clear();
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  logPath(): string {
    return PERF_LOG_FILE;
  }

  async measure<T>(
    name: string,
    details: PerfDetails | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.config.enabled) return await fn();

    const id = this.nextTaskId++;
    const startedAt = performance.now();
    const rssStart = currentRss();
    const safeDetails = sanitizeDetails(details);
    this.activeTasks.set(id, { id, name, startedAt, details: safeDetails });

    try {
      const result = await fn();
      this.finishTask(id, name, startedAt, rssStart, safeDetails);
      return result;
    } catch (err) {
      this.finishTask(id, name, startedAt, rssStart, safeDetails, err);
      throw err;
    }
  }

  measureSync<T>(
    name: string,
    details: PerfDetails | undefined,
    fn: () => T,
  ): T {
    if (!this.config.enabled) return fn();

    const id = this.nextTaskId++;
    const startedAt = performance.now();
    const rssStart = currentRss();
    const safeDetails = sanitizeDetails(details);
    this.activeTasks.set(id, { id, name, startedAt, details: safeDetails });

    try {
      const result = fn();
      this.finishTask(id, name, startedAt, rssStart, safeDetails);
      return result;
    } catch (err) {
      this.finishTask(id, name, startedAt, rssStart, safeDetails, err);
      throw err;
    }
  }

  private finishTask(
    id: number,
    name: string,
    startedAt: number,
    rssStart: number | null,
    details: PerfDetails | undefined,
    err?: unknown,
  ): void {
    this.activeTasks.delete(id);
    const durationMs = Math.round(performance.now() - startedAt);
    if (!err && durationMs < this.config.slowTaskThresholdMs) return;

    const rssEnd = currentRss();
    void this.log({
      type: "task",
      name,
      durationMs,
      details,
      error: err ? errorSummary(err) : undefined,
      rssDeltaBytes:
        rssStart !== null && rssEnd !== null ? rssEnd - rssStart : undefined,
    });
  }

  private startEventLoopMonitor(): void {
    if (this.monitorTimer !== null) return;
    this.nextExpectedTick = performance.now() + MONITOR_INTERVAL_MS;
    this.monitorTimer = setInterval(() => {
      const now = performance.now();
      const lagMs = Math.round(now - this.nextExpectedTick);
      this.nextExpectedTick = now + MONITOR_INTERVAL_MS;
      if (lagMs < this.config.eventLoopLagThresholdMs) return;
      void this.log({
        type: "eventLoopLag",
        lagMs,
        activeTasks: this.snapshotActiveTasks(now),
      });
    }, MONITOR_INTERVAL_MS);
  }

  private stopEventLoopMonitor(): void {
    if (this.monitorTimer === null) return;
    clearInterval(this.monitorTimer);
    this.monitorTimer = null;
  }

  private snapshotActiveTasks(now: number): Array<{
    id: number;
    name: string;
    runningMs: number;
    details?: PerfDetails;
  }> {
    return Array.from(this.activeTasks.values()).map((task) => ({
      id: task.id,
      name: task.name,
      runningMs: Math.round(now - task.startedAt),
      details: task.details,
    }));
  }

  private async log(payload: PerfDetails): Promise<void> {
    if (!this.config.enabled) return;
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      ...payload,
    })}\n`;

    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(PERF_LOG_DIR, { recursive: true });
        await this.rotateIfNeeded(line.length);
        await appendFile(PERF_LOG_FILE, line, "utf8");
      })
      .catch((err) => {
        console.warn("[perf-trace] write failed:", err);
      });
    await this.writeQueue;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    if (!existsSync(PERF_LOG_FILE)) return;
    try {
      const info = await stat(PERF_LOG_FILE);
      if (info.size + incomingBytes < MAX_LOG_BYTES) return;
      await rename(PERF_LOG_FILE, `${PERF_LOG_FILE}.1`);
    } catch {
      // A best-effort diagnostic log should never affect app behavior.
    }
  }
}

function sanitizeDetails(details: PerfDetails | undefined): PerfDetails | undefined {
  if (!details) return undefined;
  const out: PerfDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" && key.toLowerCase().endsWith("path")) {
      out[key.replace(/Path$/, "Name")] = basename(value);
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return out;
}

function errorSummary(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function currentRss(): number | null {
  try {
    return process.memoryUsage().rss;
  } catch {
    return null;
  }
}

export const perfTrace = new PerfTrace();
