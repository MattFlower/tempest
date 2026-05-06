// ============================================================
// Memory sampler — RSS poll for running LSP servers.
//
// On macOS we don't have /proc, so we shell out to `ps` once every 2s
// while at least one consumer is interested. Consumers register via
// start() (returns the unsubscribe function); when the last consumer
// drops, the timer stops and overhead is zero.
//
// The popover in the footer is the only consumer in phase 1: it calls
// start() on open, stop() on close.
// ============================================================

import type { LspMemorySample } from "../../shared/ipc-types";
import { perfTrace } from "../perf-trace";
import type { LspServerRegistry } from "./server-registry";

const SAMPLE_INTERVAL_MS = 2000;

export class MemorySampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private subscribers = new Set<(samples: LspMemorySample[]) => void>();

  constructor(private readonly registry: LspServerRegistry) {}

  /**
   * Register a subscriber. Returns an unsubscribe function. The poller
   * starts on the first subscribe and stops on the last unsubscribe.
   * The first sample is delivered asynchronously on the next tick — call
   * sites that need an immediate snapshot should await sampleOnce() first.
   */
  subscribe(handler: (samples: LspMemorySample[]) => void): () => void {
    this.subscribers.add(handler);
    if (this.timer === null) this.startTimer();
    return () => {
      this.subscribers.delete(handler);
      if (this.subscribers.size === 0) this.stopTimer();
    };
  }

  /**
   * Take one synchronous sample, used to seed the popover with values
   * before the first interval tick lands.
   */
  async sampleOnce(): Promise<LspMemorySample[]> {
    return await perfTrace.measure("lsp.memorySample", undefined, () =>
      collectSamples(this.registry),
    );
  }

  private startTimer(): void {
    // Fire one sample immediately so subscribers don't see "no data" for
    // up to SAMPLE_INTERVAL_MS after they register.
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, SAMPLE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const samples = await perfTrace.measure("lsp.memorySample", undefined, () =>
      collectSamples(this.registry),
    );
    for (const handler of this.subscribers) handler(samples);
  }
}

/**
 * Run `ps -o pid=,rss= -p p1,p2,...` once and parse RSS for each pid.
 * `ps` reports RSS in kilobytes on macOS; we convert to bytes for the
 * UI to format consistently with other size displays.
 *
 * Returns one sample per registered server, with rssBytes=null for
 * processes that have already exited (so the UI can show "—" rather
 * than carrying a stale value).
 */
async function collectSamples(
  registry: LspServerRegistry,
): Promise<LspMemorySample[]> {
  const live = registry.liveProcessIds();
  if (live.length === 0) return [];

  const pidArg = live.map((p) => p.pid).join(",");
  const out: LspMemorySample[] = [];
  const rssByPid = new Map<number, number | null>();

  try {
    const proc = Bun.spawn(["ps", "-o", "pid=,rss=", "-p", pidArg], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2 || !parts[0] || !parts[1]) continue;
      const pid = parseInt(parts[0], 10);
      const rssKb = parseInt(parts[1], 10);
      if (Number.isFinite(pid) && Number.isFinite(rssKb)) {
        rssByPid.set(pid, rssKb * 1024);
      }
    }
  } catch {
    // ps may have been signaled; emit null for everyone and let the UI
    // show "—". Don't surface this as an error — it's transient.
  }

  for (const { serverId, pid } of live) {
    out.push({
      serverId,
      rssBytes: rssByPid.has(pid) ? (rssByPid.get(pid) ?? null) : null,
    });
  }
  return out;
}
