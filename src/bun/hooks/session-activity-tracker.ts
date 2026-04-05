import { ActivityState } from "../../shared/ipc-types";
import type { HookEvent } from "../../shared/ipc-types";

/**
 * Tracks active Claude Code sessions by PID and their activity state.
 * Provides per-PID and per-CWD aggregate queries.
 */
export class SessionActivityTracker {
  private sessions = new Map<number, ActivityState>();
  private sessionCWDs = new Map<number, string>();
  /** Sessions that have received user input (user_prompt). Only activated sessions can show Working. */
  private activatedSessions = new Set<number>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  handleEvent(event: HookEvent): void {
    if (event.eventType === "session_end") {
      this.sessions.delete(event.pid);
      this.sessionCWDs.delete(event.pid);
      this.activatedSessions.delete(event.pid);
      return;
    }
    // A user_prompt means real user input — activate the session
    if (event.eventType === "user_prompt") {
      this.activatedSessions.add(event.pid);
    }
    this.sessions.set(event.pid, activityStateFromEvent(event.eventType));
    if (event.cwd) {
      this.sessionCWDs.set(event.pid, event.cwd);
      // When transitioning to idle, clean stale sibling PIDs immediately
      // so they don't inflate the aggregate back to Working
      if (event.eventType === "stop" || event.eventType === "idle_prompt") {
        this.cleanStalePidsForCWD(event.cwd);
      }
    }
  }

  activityState(pid: number): ActivityState | undefined {
    return this.sessions.get(pid);
  }

  removeSession(pid: number): void {
    this.sessions.delete(pid);
    this.sessionCWDs.delete(pid);
    this.activatedSessions.delete(pid);
  }

  /** Returns PIDs associated with a given working directory. */
  pidsForCWD(cwd: string): number[] {
    const result: number[] = [];
    for (const [pid, dir] of this.sessionCWDs) {
      if (dir === cwd) result.push(pid);
    }
    return result;
  }

  /** Returns the most urgent state across the given PIDs, or undefined if none tracked. */
  aggregateState(pids: number[]): ActivityState | undefined {
    let min: ActivityState | undefined;
    for (const pid of pids) {
      let state = this.sessions.get(pid);
      if (state === undefined) continue;
      // Non-activated sessions (no user input yet) can't show Working —
      // they may be auto-resuming or initializing, not doing real work
      if (state === ActivityState.Working && !this.activatedSessions.has(pid)) {
        state = ActivityState.Idle;
      }
      if (min === undefined || state < min) {
        min = state;
      }
    }
    return min;
  }

  startCleanupTimer(): void {
    this.stopCleanupTimer();
    this.cleanupTimer = setInterval(() => this.cleanStaleSessions(), 30_000);
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /** Returns aggregate state for every tracked CWD. */
  allCWDStates(): Record<string, ActivityState> {
    // Collect unique CWDs
    const cwds = new Set(this.sessionCWDs.values());
    const result: Record<string, ActivityState> = {};
    for (const cwd of cwds) {
      const pids = this.pidsForCWD(cwd);
      const state = this.aggregateState(pids);
      if (state !== undefined) result[cwd] = state;
    }
    return result;
  }

  /** Remove dead PIDs for a specific CWD. */
  private cleanStalePidsForCWD(cwd: string): void {
    for (const [pid, dir] of this.sessionCWDs) {
      if (dir !== cwd) continue;
      try {
        process.kill(pid, 0);
      } catch {
        this.sessions.delete(pid);
        this.sessionCWDs.delete(pid);
        this.activatedSessions.delete(pid);
      }
    }
  }

  /** Remove all tracked PIDs whose processes no longer exist. */
  cleanStale(): void {
    this.cleanStaleSessions();
  }

  private cleanStaleSessions(): void {
    for (const pid of this.sessions.keys()) {
      try {
        process.kill(pid, 0); // Signal 0 = check if process exists
      } catch {
        // Process no longer exists
        this.sessions.delete(pid);
        this.sessionCWDs.delete(pid);
        this.activatedSessions.delete(pid);
      }
    }
  }
}

/** Map hook event type strings to ActivityState values. */
function activityStateFromEvent(eventType: string): ActivityState {
  switch (eventType) {
    case "user_prompt":
    case "pre_tool_use":
      return ActivityState.Working;
    case "permission_request":
    case "permission_prompt":
      return ActivityState.NeedsInput;
    case "session_start":
    case "stop":
    case "idle_prompt":
    default:
      return ActivityState.Idle;
  }
}
