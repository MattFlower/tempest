import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ScheduledAgent,
  ScheduledTask,
  ScheduledTaskDraft,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
  ScheduledWorkData,
  TempestWorkspace,
} from "../../shared/ipc-types";
import { SCHEDULED_WORK_FILE } from "../config/paths";
import type { SessionManager } from "../session-manager";
import type { WorkspaceManager } from "../workspace-manager";

const TICK_MS = 30_000;
const MAX_RUNS = 200;
const MAX_OUTPUT_CHARS = 250_000;

interface PersistedScheduledWorkData {
  tasks?: ScheduledTask[];
  runs?: ScheduledTaskRun[];
}

type ChangeListener = (data: ScheduledWorkData) => void;
type CronField = { values: Set<number>; wildcard: boolean };
type ParsedCron = {
  minutes: CronField;
  hours: CronField;
  days: CronField;
  months: CronField;
  weekdays: CronField;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function intervalMs(
  every: number,
  unit: Extract<ScheduledTaskSchedule, { type: "interval" }>["unit"],
): number {
  const safeEvery = Math.max(1, Math.floor(every));
  switch (unit) {
    case "minutes": return safeEvery * 60_000;
    case "hours": return safeEvery * 60 * 60_000;
    case "days": return safeEvery * 24 * 60 * 60_000;
    case "weeks": return safeEvery * 7 * 24 * 60 * 60_000;
  }
}

function parseCronField(
  raw: string,
  min: number,
  max: number,
  sundayAlias = false,
): CronField | null {
  const values = new Set<number>();
  const parts = raw.split(",");
  const wildcard = raw.trim() === "*";
  if (parts.length === 0) return null;

  for (const part of parts) {
    const [rangePart, stepPart] = part.trim().split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!rangePart || !Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const range = rangePart.split("-").map(Number);
      const a = range[0];
      const b = range[1];
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      start = a!;
      end = b!;
    } else {
      const n = Number(rangePart);
      if (!Number.isInteger(n)) return null;
      start = n;
      end = n;
    }

    if (sundayAlias) {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
    }
    if (start < min || start > max || end < min || end > max) return null;

    if (start <= end) {
      for (let n = start; n <= end; n += step) values.add(n);
    } else if (sundayAlias) {
      for (let n = start; n <= max; n += step) values.add(n);
      for (let n = min; n <= end; n += step) values.add(n);
    } else {
      return null;
    }
  }

  return { values, wildcard };
}

function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = parseCronField(fields[0]!, 0, 59);
  const hours = parseCronField(fields[1]!, 0, 23);
  const days = parseCronField(fields[2]!, 1, 31);
  const months = parseCronField(fields[3]!, 1, 12);
  const weekdays = parseCronField(fields[4]!, 0, 7, true);
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  return { minutes, hours, days, months, weekdays };
}

function cronDayMatches(parsed: ParsedCron, candidate: Date): boolean {
  const dayMatches = parsed.days.values.has(candidate.getDate());
  const weekdayMatches = parsed.weekdays.values.has(candidate.getDay());
  if (parsed.days.wildcard && parsed.weekdays.wildcard) return true;
  if (parsed.days.wildcard) return weekdayMatches;
  if (parsed.weekdays.wildcard) return dayMatches;
  return dayMatches || weekdayMatches;
}

function nextCronRun(expression: string, after: Date): string | undefined {
  const parsed = parseCron(expression);
  if (!parsed) return undefined;
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(after);
  limit.setFullYear(limit.getFullYear() + 2);

  while (candidate <= limit) {
    if (
      parsed.minutes.values.has(candidate.getMinutes()) &&
      parsed.hours.values.has(candidate.getHours()) &&
      parsed.months.values.has(candidate.getMonth() + 1) &&
      cronDayMatches(parsed, candidate)
    ) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return undefined;
}

export function computeNextRunAt(
  schedule: ScheduledTaskSchedule,
  from = new Date(),
): string | undefined {
  if (schedule.type === "once") {
    const runAt = new Date(schedule.runAt);
    if (!Number.isFinite(runAt.getTime())) return undefined;
    return runAt.getTime() > from.getTime() ? runAt.toISOString() : undefined;
  }

  if (schedule.type === "cron") {
    return nextCronRun(schedule.expression, from);
  }

  const startAt = new Date(schedule.startAt);
  if (!Number.isFinite(startAt.getTime())) return undefined;
  const ms = intervalMs(schedule.every, schedule.unit);
  if (startAt.getTime() > from.getTime()) return startAt.toISOString();
  const elapsed = from.getTime() - startAt.getTime();
  return new Date(startAt.getTime() + (Math.floor(elapsed / ms) + 1) * ms).toISOString();
}

function validateSchedule(schedule: ScheduledTaskSchedule): string | null {
  if (schedule.type === "once") {
    if (!Number.isFinite(new Date(schedule.runAt).getTime())) return "Choose a valid run date.";
    return null;
  }
  if (schedule.type === "cron") {
    if (!parseCron(schedule.expression)) {
      return "Use a five-field cron expression: minute hour day-of-month month day-of-week.";
    }
    if (!computeNextRunAt(schedule)) return "Cron expression has no run time in the next two years.";
    return null;
  }
  if (!Number.isFinite(new Date(schedule.startAt).getTime())) return "Choose a valid start date.";
  if (!Number.isFinite(schedule.every) || schedule.every < 1) return "Interval must be at least 1.";
  return null;
}

function normalizeSchedule(schedule: ScheduledTaskSchedule): ScheduledTaskSchedule {
  if (schedule.type === "once") {
    return { type: "once", runAt: new Date(schedule.runAt).toISOString() };
  }
  if (schedule.type === "cron") {
    return { type: "cron", expression: schedule.expression.trim() };
  }
  return {
    type: "interval",
    every: Math.max(1, Math.floor(schedule.every)),
    unit: schedule.unit,
    startAt: new Date(schedule.startAt).toISOString(),
  };
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
  onText: (text: string) => void,
) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) onText(decoder.decode(value, { stream: true }));
    }
    const final = decoder.decode();
    if (final) onText(final);
  } finally {
    reader.releaseLock();
  }
}

export class ScheduledWorkManager {
  private tasks: ScheduledTask[] = [];
  private runs: ScheduledTaskRun[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  private running = new Map<string, ReturnType<typeof Bun.spawn>>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly sessionManager: SessionManager,
    private readonly onChange?: ChangeListener,
  ) {}

  async start() {
    await this.load();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }
    void this.tick();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const activeRuns = [...this.running.entries()];
    if (activeRuns.length > 0) {
      const finishedAt = nowIso();
      const stopPromises: Promise<void>[] = [];
      for (const [runId, proc] of activeRuns) {
        this.running.delete(runId);
        this.updateRun(runId, {
          status: "canceled",
          finishedAt,
          error: "Tempest shut down before this run finished.",
        });
        stopPromises.push(this.stopProcess(proc));
      }
      await this.persistAndNotify();
      await Promise.allSettled(stopPromises);
    }

    await this.persistQueue.catch(() => {});
  }

  async data(): Promise<ScheduledWorkData> {
    await this.load();
    return this.snapshot();
  }

  async createTask(draft: ScheduledTaskDraft): Promise<{ success: boolean; error?: string; task?: ScheduledTask }> {
    await this.load();
    const resolved = this.resolveDraft(draft);
    if ("error" in resolved) return { success: false, error: resolved.error };
    const createdAt = nowIso();
    const schedule = normalizeSchedule(draft.schedule);
    const task: ScheduledTask = {
      id: createId("task"),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      agent: draft.agent,
      workspacePath: resolved.workspace.path,
      workspaceName: resolved.workspace.name,
      repoPath: resolved.workspace.repoPath,
      repoName: resolved.repoName,
      schedule,
      enabled: draft.enabled ?? true,
      createdAt,
      updatedAt: createdAt,
      nextRunAt: draft.enabled === false ? undefined : computeNextRunAt(schedule),
    };
    this.tasks = [task, ...this.tasks];
    await this.persistAndNotify();
    return { success: true, task };
  }

  async updateTask(
    taskId: string,
    patch: Partial<ScheduledTaskDraft> & { enabled?: boolean },
  ): Promise<{ success: boolean; error?: string; task?: ScheduledTask }> {
    await this.load();
    const existing = this.tasks.find((task) => task.id === taskId);
    if (!existing) return { success: false, error: "Scheduled task not found." };

    const mergedDraft: ScheduledTaskDraft = {
      title: patch.title ?? existing.title,
      prompt: patch.prompt ?? existing.prompt,
      agent: patch.agent ?? existing.agent,
      workspacePath: patch.workspacePath ?? existing.workspacePath,
      schedule: patch.schedule ?? existing.schedule,
      enabled: patch.enabled ?? existing.enabled,
    };
    const resolved = this.resolveDraft(mergedDraft);
    if ("error" in resolved) return { success: false, error: resolved.error };
    const schedule = normalizeSchedule(mergedDraft.schedule);
    const enabled = patch.enabled ?? existing.enabled;
    const task: ScheduledTask = {
      ...existing,
      title: mergedDraft.title.trim(),
      prompt: mergedDraft.prompt.trim(),
      agent: mergedDraft.agent,
      workspacePath: resolved.workspace.path,
      workspaceName: resolved.workspace.name,
      repoPath: resolved.workspace.repoPath,
      repoName: resolved.repoName,
      schedule,
      enabled,
      updatedAt: nowIso(),
      nextRunAt: enabled ? computeNextRunAt(schedule) : undefined,
    };
    this.tasks = this.tasks.map((item) => item.id === taskId ? task : item);
    await this.persistAndNotify();
    return { success: true, task };
  }

  async deleteTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    await this.load();
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
    await this.persistAndNotify();
    return { success: true };
  }

  async runTaskNow(taskId: string): Promise<{ success: boolean; error?: string; run?: ScheduledTaskRun }> {
    await this.load();
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) return { success: false, error: "Scheduled task not found." };
    const run = await this.startRun(task, "manual", nowIso());
    return { success: true, run };
  }

  async cancelRun(runId: string): Promise<{ success: boolean; error?: string }> {
    await this.load();
    const proc = this.running.get(runId);
    if (!proc) return { success: false, error: "Run is not active." };
    proc.kill();
    this.running.delete(runId);
    this.updateRun(runId, {
      status: "canceled",
      finishedAt: nowIso(),
      error: "Canceled by user.",
    });
    await this.persistAndNotify();
    return { success: true };
  }

  private resolveDraft(draft: ScheduledTaskDraft): { workspace: TempestWorkspace; repoName: string } | { error: string } {
    const title = draft.title.trim();
    const prompt = draft.prompt.trim();
    if (!title) return { error: "Add a task title." };
    if (!prompt) return { error: "Add instructions for the agent." };
    if (!["claude", "pi", "codex"].includes(draft.agent)) return { error: "Choose a supported agent." };
    const scheduleError = validateSchedule(draft.schedule);
    if (scheduleError) return { error: scheduleError };

    const workspace = this.workspaceManager.findWorkspaceByPath(draft.workspacePath);
    if (!workspace) return { error: "Choose an existing workspace." };
    const repo = this.workspaceManager.getRepos().find((item) => item.path === workspace.repoPath);
    return { workspace, repoName: repo?.name ?? workspace.repoPath.split("/").at(-1) ?? workspace.repoPath };
  }

  private async tick() {
    await this.load();
    const now = Date.now();
    for (const task of this.tasks) {
      if (!task.enabled || !task.nextRunAt) continue;
      if (this.runningForTask(task.id)) continue;
      if (new Date(task.nextRunAt).getTime() > now) continue;

      const scheduledFor = task.nextRunAt;
      const nextRunAt = task.schedule.type === "once" ? undefined : computeNextRunAt(task.schedule);
      this.tasks = this.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              enabled: item.schedule.type === "once" ? false : item.enabled,
              nextRunAt,
              updatedAt: nowIso(),
            }
          : item,
      );
      await this.startRun(task, "schedule", scheduledFor);
    }
  }

  private runningForTask(taskId: string): boolean {
    return this.runs.some((run) => run.taskId === taskId && run.status === "running");
  }

  private async startRun(
    task: ScheduledTask,
    trigger: ScheduledTaskRun["trigger"],
    scheduledFor: string,
  ): Promise<ScheduledTaskRun> {
    const run: ScheduledTaskRun = {
      id: createId("run"),
      taskId: task.id,
      taskTitle: task.title,
      agent: task.agent,
      workspacePath: task.workspacePath,
      workspaceName: task.workspaceName,
      repoName: task.repoName,
      status: "running",
      trigger,
      scheduledFor,
      startedAt: nowIso(),
      output: "",
    };
    this.runs = [run, ...this.runs].slice(0, MAX_RUNS);
    this.tasks = this.tasks.map((item) => item.id === task.id ? { ...item, lastRunId: run.id } : item);
    await this.persistAndNotify();
    void this.executeRun(run.id, task);
    return run;
  }

  private async executeRun(runId: string, task: ScheduledTask) {
    try {
      const { command } = await this.buildCommand(task.agent, task.workspacePath, task.prompt);
      const proc = Bun.spawn(command, {
        cwd: task.workspacePath,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: Bun.env,
      });
      this.running.set(runId, proc);

      const append = (text: string) => {
        this.updateRun(runId, (current) => ({
          output: (current.output + text).slice(-MAX_OUTPUT_CHARS),
        }));
        void this.persistAndNotify().catch((err) => {
          console.warn("[scheduled-work] Failed to persist run output:", err);
        });
      };
      await Promise.all([
        readStream(proc.stdout, append),
        readStream(proc.stderr, append),
      ]);
      const exitCode = await proc.exited;
      this.running.delete(runId);
      const current = this.runs.find((item) => item.id === runId);
      if (current?.status !== "canceled") {
        this.updateRun(runId, {
          status: exitCode === 0 ? "succeeded" : "failed",
          exitCode,
          finishedAt: nowIso(),
        });
      }
    } catch (err) {
      this.running.delete(runId);
      const current = this.runs.find((item) => item.id === runId);
      if (current?.status !== "canceled") {
        this.updateRun(runId, {
          status: "failed",
          finishedAt: nowIso(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.persistAndNotify();
  }

  private async stopProcess(proc: ReturnType<typeof Bun.spawn>) {
    try {
      proc.kill("SIGTERM");
    } catch {
      return;
    }

    const result = await Promise.race([
      proc.exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_000)),
    ]);
    if (result === "timeout") {
      try {
        proc.kill("SIGKILL");
      } catch {}
      await Promise.race([
        proc.exited,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
      ]);
    }
  }

  private buildCommand(agent: ScheduledAgent, workspacePath: string, prompt: string): Promise<{ command: string[] }> {
    if (agent === "claude") return this.sessionManager.buildClaudeBatchCommand({ workspacePath, prompt });
    if (agent === "pi") return this.sessionManager.buildPiBatchCommand({ workspacePath, prompt });
    return this.sessionManager.buildCodexBatchCommand({ workspacePath, prompt });
  }

  private updateRun(
    runId: string,
    patch: Partial<ScheduledTaskRun> | ((current: ScheduledTaskRun) => Partial<ScheduledTaskRun>),
  ) {
    this.runs = this.runs.map((run) => {
      if (run.id !== runId) return run;
      const update = typeof patch === "function" ? patch(run) : patch;
      return { ...run, ...update };
    });
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const file = Bun.file(SCHEDULED_WORK_FILE);
    if (!(await file.exists())) return;
    try {
      const raw = await file.json() as PersistedScheduledWorkData;
      this.tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
      this.runs = Array.isArray(raw.runs)
        ? raw.runs.map((run) =>
            run.status === "running"
              ? {
                  ...run,
                  status: "failed",
                  finishedAt: run.finishedAt ?? nowIso(),
                  error: run.error ?? "Tempest quit before this run finished.",
                }
              : run,
          )
        : [];
      this.tasks = this.tasks.map((task) => ({
        ...task,
        nextRunAt: task.enabled ? task.nextRunAt ?? computeNextRunAt(task.schedule) : undefined,
      }));
    } catch (err) {
      console.warn("[scheduled-work] Failed to load scheduled work:", err);
      this.tasks = [];
      this.runs = [];
    }
  }

  private async persistAndNotify() {
    const writeLatest = async () => {
      mkdirSync(dirname(SCHEDULED_WORK_FILE), { recursive: true });
      await Bun.write(
        SCHEDULED_WORK_FILE,
        JSON.stringify({ tasks: this.tasks, runs: this.runs }, null, 2),
      );
      this.onChange?.(this.snapshot());
    };

    const queued = this.persistQueue.then(writeLatest, writeLatest);
    this.persistQueue = queued.catch((err) => {
      console.warn("[scheduled-work] Failed to persist scheduled work:", err);
    });
    return queued;
  }

  private snapshot(): ScheduledWorkData {
    return {
      tasks: [...this.tasks].sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? "")),
      runs: [...this.runs],
    };
  }
}
