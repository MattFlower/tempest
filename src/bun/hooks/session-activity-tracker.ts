import { ActivityState } from "../../shared/ipc-types";
import type { HookEvent } from "../../shared/ipc-types";

/**
 * Tracks active Claude Code sessions by PID and their activity state.
 * Provides per-PID and per-CWD aggregate queries.
 */
export class SessionActivityTracker {
  private sessions = new Map<number, ActivityState>();
  private sessionCWDs = new Map<number, string>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  handleEvent(event: HookEvent): void {
    if (event.eventType === "session_end") {
      this.sessions.delete(event.pid);
      this.sessionCWDs.delete(event.pid);
      return;
    }
    this.sessions.set(event.pid, activityStateFromEvent(event.eventType));
    if (event.cwd) {
      this.sessionCWDs.set(event.pid, event.cwd);
    }
  }

  activityState(pid: number): ActivityState | undefined {
    return this.sessions.get(pid);
  }

  removeSession(pid: number): void {
    this.sessions.delete(pid);
    this.sessionCWDs.delete(pid);
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
      const state = this.sessions.get(pid);
      if (state !== undefined && (min === undefined || state < min)) {
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

  private cleanStaleSessions(): void {
    for (const pid of this.sessions.keys()) {
      try {
        process.kill(pid, 0); // Signal 0 = check if process exists
      } catch {
        // Process no longer exists
        this.sessions.delete(pid);
        this.sessionCWDs.delete(pid);
      }
    }
  }
}

/** Map hook event type strings to ActivityState values. */
function activityStateFromEvent(eventType: string): ActivityState {
  switch (eventType) {
    case "session_start":
    case "user_prompt":
    case "pre_tool_use":
      return ActivityState.Working;
    case "permission_request":
    case "permission_prompt":
      return ActivityState.NeedsInput;
    case "stop":
    case "idle_prompt":
      return ActivityState.Idle;
    default:
      return ActivityState.Working;
  }
}
