import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScheduledAgent,
  ScheduledTask,
  ScheduledTaskDraft,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
  ScheduledWorkData,
  TempestWorkspace,
} from "../../../../shared/ipc-types";
import { api, onScheduledWorkChanged } from "../../state/rpc-client";
import { useStore } from "../../state/store";

type ScheduleMode = ScheduledTaskSchedule["type"];

interface WorkspaceOption {
  path: string;
  name: string;
  repoName: string;
}

const AGENTS: Array<{ id: ScheduledAgent; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "pi", label: "Pi" },
  { id: "codex", label: "Codex" },
];

function dateTimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLocalFromIso(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return dateTimeLocalValue(new Date());
  return dateTimeLocalValue(date);
}

function isoFromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function formatWhen(value?: string): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatFullTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "once") return `Once at ${formatWhen(schedule.runAt)}`;
  if (schedule.type === "cron") return `Cron ${schedule.expression}`;
  return `Every ${schedule.every} ${schedule.unit}`;
}

function statusColor(status: ScheduledTaskRun["status"]): string {
  switch (status) {
    case "running": return "var(--ctp-blue)";
    case "succeeded": return "var(--ctp-green)";
    case "failed": return "var(--ctp-red)";
    case "canceled": return "var(--ctp-yellow)";
    case "queued": return "var(--ctp-mauve)";
  }
}

function defaultForm(workspacePath: string | null): {
  title: string;
  prompt: string;
  agent: ScheduledAgent;
  workspacePath: string;
  mode: ScheduleMode;
  runAt: string;
  intervalEvery: number;
  intervalUnit: Extract<ScheduledTaskSchedule, { type: "interval" }>["unit"];
  intervalStartAt: string;
  cronExpression: string;
} {
  const oneHour = new Date(Date.now() + 60 * 60_000);
  return {
    title: "",
    prompt: "",
    agent: "codex",
    workspacePath: workspacePath ?? "",
    mode: "once",
    runAt: dateTimeLocalValue(oneHour),
    intervalEvery: 1,
    intervalUnit: "days",
    intervalStartAt: dateTimeLocalValue(oneHour),
    cronExpression: "0 9 * * 1-5",
  };
}

function formFromTask(task: ScheduledTask): ReturnType<typeof defaultForm> {
  const form = defaultForm(task.workspacePath);
  if (task.schedule.type === "once") {
    return {
      ...form,
      title: task.title,
      prompt: task.prompt,
      agent: task.agent,
      workspacePath: task.workspacePath,
      mode: "once",
      runAt: dateTimeLocalFromIso(task.schedule.runAt),
    };
  }
  if (task.schedule.type === "cron") {
    return {
      ...form,
      title: task.title,
      prompt: task.prompt,
      agent: task.agent,
      workspacePath: task.workspacePath,
      mode: "cron",
      cronExpression: task.schedule.expression,
    };
  }
  return {
    ...form,
    title: task.title,
    prompt: task.prompt,
    agent: task.agent,
    workspacePath: task.workspacePath,
    mode: "interval",
    intervalEvery: task.schedule.every,
    intervalUnit: task.schedule.unit,
    intervalStartAt: dateTimeLocalFromIso(task.schedule.startAt),
  };
}

export function ScheduledWorkView() {
  const selectedWorkspacePath = useStore((s) => s.selectedWorkspacePath);
  const storeRepos = useStore((s) => s.repos);
  const storeWorkspaces = useStore((s) => s.workspacesByRepo);
  const setRepos = useStore((s) => s.setRepos);
  const setWorkspaces = useStore((s) => s.setWorkspaces);

  const [data, setData] = useState<ScheduledWorkData>({ tasks: [], runs: [] });
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState(() => defaultForm(selectedWorkspacePath));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const result = await api.getScheduledWorkData();
    setData(result);
    setSelectedRunId((current) => current ?? result.runs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    loadData().catch((err) => setError(err?.message ?? String(err)));
    const unsubscribe = onScheduledWorkChanged((next) => {
      setData(next);
      setSelectedRunId((current) => current ?? next.runs[0]?.id ?? null);
    });
    const timer = setInterval(() => {
      loadData().catch(() => {});
    }, 5_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [loadData]);

  useEffect(() => {
    if (form.workspacePath || !selectedWorkspacePath) return;
    setForm((prev) => ({ ...prev, workspacePath: selectedWorkspacePath }));
  }, [form.workspacePath, selectedWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaces() {
      try {
        const repos = storeRepos.length > 0 ? storeRepos : await api.getRepos();
        if (!cancelled && storeRepos.length === 0) setRepos(repos);
        const options: WorkspaceOption[] = [];
        for (const repo of repos) {
          const existing = storeWorkspaces[repo.id];
          const workspaces: TempestWorkspace[] = existing ?? await api.getWorkspaces(repo.id);
          if (!cancelled && !existing) setWorkspaces(repo.id, workspaces);
          for (const ws of workspaces) {
            options.push({ path: ws.path, name: ws.name, repoName: repo.name });
          }
        }
        if (!cancelled) {
          setWorkspaceOptions(options);
          setForm((prev) => ({
            ...prev,
            workspacePath: prev.workspacePath || selectedWorkspacePath || options[0]?.path || "",
          }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadWorkspaces();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspacePath, setRepos, setWorkspaces, storeRepos, storeWorkspaces]);

  const selectedRun = useMemo(
    () => data.runs.find((run) => run.id === selectedRunId) ?? data.runs[0],
    [data.runs, selectedRunId],
  );

  const runningRuns = data.runs.filter((run) => run.status === "running");
  const recentRuns = data.runs.filter((run) => run.status !== "running").slice(0, 12);

  const schedule = useMemo<ScheduledTaskSchedule>(() => {
    if (form.mode === "cron") return { type: "cron", expression: form.cronExpression };
    if (form.mode === "interval") {
      return {
        type: "interval",
        every: form.intervalEvery,
        unit: form.intervalUnit,
        startAt: isoFromLocalInput(form.intervalStartAt),
      };
    }
    return { type: "once", runAt: isoFromLocalInput(form.runAt) };
  }, [form]);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const draft: ScheduledTaskDraft = {
        title: form.title,
        prompt: form.prompt,
        agent: form.agent,
        workspacePath: form.workspacePath,
        schedule,
        enabled: true,
      };
      const result = editingTaskId
        ? await api.updateScheduledTask(editingTaskId, draft)
        : await api.createScheduledTask(draft);
      if (!result.success) {
        setError(result.error ?? "Could not save scheduled task.");
        return;
      }
      setEditingTaskId(null);
      setForm(defaultForm(form.workspacePath));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editingTaskId, form, loadData, schedule]);

  const startEditing = useCallback((task: ScheduledTask) => {
    setEditingTaskId(task.id);
    setForm(formFromTask(task));
    setError(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingTaskId(null);
    setForm(defaultForm(form.workspacePath || selectedWorkspacePath));
    setError(null);
  }, [form.workspacePath, selectedWorkspacePath]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[var(--ctp-base)]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ctp-surface0)]">
        <div>
          <div className="text-sm font-medium text-[var(--ctp-text)]">Scheduled Work</div>
          <div className="text-xs text-[var(--ctp-overlay1)]">
            {data.tasks.length} tasks · {runningRuns.length} running
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="h-8 w-8 rounded flex items-center justify-center text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)] hover:bg-[var(--ctp-surface0)] disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
          >
            <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
            <path d="M13.5 1v3.5H10" />
            <path d="M2.5 15v-3.5H6" />
          </svg>
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[360px_minmax(360px,1fr)_420px]">
        <form onSubmit={submit} className="min-h-0 overflow-y-auto border-r border-[var(--ctp-surface0)] p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--ctp-overlay1)]">
                {editingTaskId ? "Edit Task" : "New Task"}
              </div>
              {editingTaskId && (
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="rounded px-2 py-1 text-xs text-[var(--ctp-overlay1)] hover:bg-[var(--ctp-surface0)] hover:text-[var(--ctp-text)]"
                >
                  Cancel
                </button>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Title</span>
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                placeholder="Nightly dependency sweep"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Workspace</span>
              <select
                value={form.workspacePath}
                onChange={(e) => setForm((prev) => ({ ...prev, workspacePath: e.target.value }))}
                className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
              >
                {workspaceOptions.map((ws) => (
                  <option key={ws.path} value={ws.path}>
                    {ws.repoName} / {ws.name}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Agent</span>
              <div className="grid grid-cols-3 rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] p-1">
                {AGENTS.map((agent) => (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => setForm((prev) => ({ ...prev, agent: agent.id }))}
                    className={[
                      "rounded px-2 py-1.5 text-xs transition-colors",
                      form.agent === agent.id
                        ? "bg-[var(--ctp-surface1)] text-[var(--ctp-text)]"
                        : "text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)]",
                    ].join(" ")}
                  >
                    {agent.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Instructions</span>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
                className="min-h-36 w-full resize-y rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                placeholder="Check for flaky tests and open a concise summary with suggested fixes."
              />
            </label>

            <div>
              <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Schedule</span>
              <div className="grid grid-cols-3 rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] p-1">
                {(["once", "interval", "cron"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setForm((prev) => ({ ...prev, mode }))}
                    className={[
                      "rounded px-2 py-1.5 text-xs capitalize transition-colors",
                      form.mode === mode
                        ? "bg-[var(--ctp-surface1)] text-[var(--ctp-text)]"
                        : "text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)]",
                    ].join(" ")}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {form.mode === "once" && (
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Run At</span>
                <input
                  type="datetime-local"
                  value={form.runAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, runAt: e.target.value }))}
                  className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                />
              </label>
            )}

            {form.mode === "interval" && (
              <div className="grid grid-cols-[1fr_1.5fr] gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Every</span>
                  <input
                    type="number"
                    min={1}
                    value={form.intervalEvery}
                    onChange={(e) => setForm((prev) => ({ ...prev, intervalEvery: Number(e.target.value) }))}
                    className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Unit</span>
                  <select
                    value={form.intervalUnit}
                    onChange={(e) => setForm((prev) => ({ ...prev, intervalUnit: e.target.value as typeof form.intervalUnit }))}
                    className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                  </select>
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Start At</span>
                  <input
                    type="datetime-local"
                    value={form.intervalStartAt}
                    onChange={(e) => setForm((prev) => ({ ...prev, intervalStartAt: e.target.value }))}
                    className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                  />
                </label>
              </div>
            )}

            {form.mode === "cron" && (
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--ctp-overlay1)]">Cron</span>
                <input
                  value={form.cronExpression}
                  onChange={(e) => setForm((prev) => ({ ...prev, cronExpression: e.target.value }))}
                  className="w-full rounded border border-[var(--ctp-surface1)] bg-[var(--ctp-mantle)] px-2.5 py-2 font-mono text-sm text-[var(--ctp-text)] outline-none focus:border-[var(--ctp-blue)]"
                  placeholder="0 9 * * 1-5"
                />
              </label>
            )}

            {error && (
              <div className="rounded border border-[var(--ctp-red)]/40 bg-[var(--ctp-red)]/10 px-3 py-2 text-xs text-[var(--ctp-red)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !form.workspacePath}
              className="w-full rounded bg-[var(--ctp-blue)] px-3 py-2 text-sm font-medium text-[var(--ctp-base)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : editingTaskId ? "Save Task" : "Schedule Task"}
            </button>
          </div>
        </form>

        <div className="min-h-0 overflow-y-auto p-4">
          {runningRuns.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ctp-overlay1)]">Running</div>
              <div className="space-y-2">
                {runningRuns.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    selected={selectedRun?.id === run.id}
                    onSelect={() => setSelectedRunId(run.id)}
                    onCancel={() => api.cancelScheduledRun(run.id).then(loadData)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mb-5">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ctp-overlay1)]">Tasks</div>
            <div className="space-y-2">
              {data.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onRun={() => api.runScheduledTaskNow(task.id).then((res: { run?: ScheduledTaskRun }) => {
                    if (res.run) setSelectedRunId(res.run.id);
                    return loadData();
                  })}
                  onToggle={() => api.updateScheduledTask(task.id, { enabled: !task.enabled }).then(loadData)}
                  onEdit={() => startEditing(task)}
                  onDelete={() => api.deleteScheduledTask(task.id).then(loadData)}
                />
              ))}
              {data.tasks.length === 0 && (
                <div className="rounded border border-dashed border-[var(--ctp-surface1)] px-4 py-10 text-center text-sm text-[var(--ctp-overlay1)]">
                  No scheduled tasks
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ctp-overlay1)]">Recent Runs</div>
            <div className="space-y-2">
              {recentRuns.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={selectedRun?.id === run.id}
                  onSelect={() => setSelectedRunId(run.id)}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="min-h-0 border-l border-[var(--ctp-surface0)]">
          {selectedRun ? (
            <RunDetail run={selectedRun} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--ctp-overlay1)]">
              No runs yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: ScheduledTask;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded border border-[var(--ctp-surface0)] bg-[var(--ctp-mantle)] p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--ctp-text)]">{task.title}</div>
          <div className="truncate text-xs text-[var(--ctp-overlay1)]">
            {task.repoName} / {task.workspaceName} · {task.agent}
          </div>
        </div>
        <span
          className="rounded px-2 py-0.5 text-[11px]"
          style={{
            backgroundColor: task.enabled ? "rgba(166, 227, 161, 0.12)" : "var(--ctp-surface0)",
            color: task.enabled ? "var(--ctp-green)" : "var(--ctp-overlay1)",
          }}
        >
          {task.enabled ? "Enabled" : "Paused"}
        </span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-[var(--ctp-overlay1)]">
        <span className="truncate">{scheduleLabel(task.schedule)}</span>
        <span className="shrink-0">{formatWhen(task.nextRunAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onRun} className="rounded px-2 py-1 text-xs text-[var(--ctp-green)] hover:bg-[var(--ctp-surface0)]">
          Run
        </button>
        <button type="button" onClick={onToggle} className="rounded px-2 py-1 text-xs text-[var(--ctp-blue)] hover:bg-[var(--ctp-surface0)]">
          {task.enabled ? "Pause" : "Enable"}
        </button>
        <button type="button" onClick={onEdit} className="rounded px-2 py-1 text-xs text-[var(--ctp-mauve)] hover:bg-[var(--ctp-surface0)]">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="ml-auto rounded px-2 py-1 text-xs text-[var(--ctp-red)] hover:bg-[var(--ctp-surface0)]">
          Delete
        </button>
      </div>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
  onCancel,
}: {
  run: ScheduledTaskRun;
  selected: boolean;
  onSelect: () => void;
  onCancel?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full rounded border p-3 text-left transition-colors",
        selected
          ? "border-[var(--ctp-blue)] bg-[var(--ctp-surface0)]"
          : "border-[var(--ctp-surface0)] bg-[var(--ctp-mantle)] hover:border-[var(--ctp-surface1)]",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-[var(--ctp-text)]">{run.taskTitle}</span>
        <span className="shrink-0 rounded px-2 py-0.5 text-[11px]" style={{ color: statusColor(run.status), backgroundColor: "var(--ctp-surface0)" }}>
          {run.status}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--ctp-overlay1)]">
        <span className="truncate">{run.repoName} / {run.workspaceName} · {run.agent}</span>
        <span className="shrink-0">{formatWhen(run.startedAt ?? run.scheduledFor)}</span>
      </div>
      {onCancel && (
        <div className="mt-2">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }
            }}
            className="inline-flex rounded px-2 py-1 text-xs text-[var(--ctp-red)] hover:bg-[var(--ctp-surface1)]"
          >
            Cancel
          </span>
        </div>
      )}
    </button>
  );
}

function RunDetail({ run }: { run: ScheduledTaskRun }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--ctp-surface0)] p-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm font-medium text-[var(--ctp-text)]">{run.taskTitle}</div>
          <span className="rounded px-2 py-0.5 text-[11px]" style={{ color: statusColor(run.status), backgroundColor: "var(--ctp-surface0)" }}>
            {run.status}
          </span>
        </div>
        <div className="text-xs text-[var(--ctp-overlay1)]">
          Started {formatFullTime(run.startedAt)}{run.finishedAt ? ` · Finished ${formatFullTime(run.finishedAt)}` : ""}
        </div>
        {run.exitCode !== undefined && (
          <div className="mt-1 text-xs text-[var(--ctp-overlay1)]">Exit {run.exitCode}</div>
        )}
        {run.error && (
          <div className="mt-2 rounded border border-[var(--ctp-red)]/40 bg-[var(--ctp-red)]/10 px-2 py-1.5 text-xs text-[var(--ctp-red)]">
            {run.error}
          </div>
        )}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[var(--ctp-crust)] p-4 font-mono text-xs leading-5 text-[var(--ctp-text)]">
        {run.output || "No output yet"}
      </pre>
    </div>
  );
}
