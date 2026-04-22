import { useMemo, useState } from "react";
import { COMMANDS, effectiveKeystrokeFor, type Command, type CommandCategory } from "../../commands/registry";
import { formatKeystroke, parseKeystroke } from "../../keybindings/keystroke";
import { KeybindingRecorder } from "./KeybindingRecorder";

type Overrides = Record<string, string | null>;

interface Props {
  keybindings: Overrides;
  setKeybindings: (next: Overrides) => void;
}

const CATEGORY_LABEL: Record<CommandCategory, string> = {
  palette: "Command Palette",
  tabs: "Tabs",
  panes: "Panes",
  view: "Views",
  workspace: "Workspace",
  repo: "Repositories",
  claude: "Claude",
  github: "GitHub",
  app: "App",
  help: "Help",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "palette", "tabs", "panes", "view", "workspace", "repo", "claude", "github", "app", "help",
];

interface PendingConflict {
  keystroke: string;
  targetCommandId: string;
  conflictingCommandId: string;
}

export function KeybindingsTab({ keybindings, setKeybindings }: Props) {
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const byCat = new Map<CommandCategory, Command[]>();
    for (const cmd of filtered) {
      const list = byCat.get(cmd.category) ?? [];
      list.push(cmd);
      byCat.set(cmd.category, list);
    }
    return CATEGORY_ORDER
      .filter((cat) => byCat.has(cat))
      .map((cat) => ({ category: cat, commands: byCat.get(cat)! }));
  }, [filtered]);

  // Find which command currently owns a given keystroke (or a chord prefix that
  // would shadow it at dispatch time), excluding a specified command.
  function findConflict(keystroke: string, excludeCommandId: string): string | null {
    const newChords = parseKeystroke(keystroke);
    if (newChords.length === 0) return null;

    for (const cmd of COMMANDS) {
      if (cmd.id === excludeCommandId) continue;
      const existing = effectiveKeystrokeFor(cmd.id, keybindings);
      if (!existing) continue;
      const existingChords = parseKeystroke(existing);
      if (existingChords.length === 0) continue;

      // Exact match
      if (existing === keystroke) return cmd.id;

      // Prefix collisions — dispatcher resolves chord-prefix before exact,
      // so either direction of prefix overlap is a conflict.
      if (newChords.length === 1 && existingChords.length === 2 && existingChords[0] === newChords[0]) {
        return cmd.id;
      }
      if (newChords.length === 2 && existingChords.length === 1 && newChords[0] === existingChords[0]) {
        return cmd.id;
      }
    }
    return null;
  }

  function setBinding(commandId: string, keystroke: string | null) {
    const next = { ...keybindings };
    const cmd = COMMANDS.find((c) => c.id === commandId);
    // If the new value matches the default, drop the override entirely.
    if (keystroke !== null && cmd?.defaultKeybinding === keystroke) {
      delete next[commandId];
    } else {
      next[commandId] = keystroke;
    }
    setKeybindings(next);
  }

  function resetBinding(commandId: string) {
    const next = { ...keybindings };
    delete next[commandId];
    setKeybindings(next);
  }

  function handleRecorderCommit(commandId: string, keystroke: string) {
    setRecordingId(null);
    const conflictId = findConflict(keystroke, commandId);
    if (conflictId) {
      setConflict({ keystroke, targetCommandId: commandId, conflictingCommandId: conflictId });
      return;
    }
    setBinding(commandId, keystroke);
  }

  function resolveConflictReassign() {
    if (!conflict) return;
    const next = { ...keybindings, [conflict.conflictingCommandId]: null };
    const cmd = COMMANDS.find((c) => c.id === conflict.targetCommandId);
    if (cmd?.defaultKeybinding === conflict.keystroke) {
      delete next[conflict.targetCommandId];
    } else {
      next[conflict.targetCommandId] = conflict.keystroke;
    }
    setKeybindings(next);
    setConflict(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
          Reassign any shortcut. Chord sequences (e.g. ⌘K ⌘S) are supported.
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands…"
          className="px-2 py-1.5 rounded text-sm outline-none"
          style={{
            backgroundColor: "var(--ctp-surface1)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface2)",
          }}
        />
      </div>

      {conflict && (
        <ConflictBanner
          conflict={conflict}
          onReassign={resolveConflictReassign}
          onCancel={() => setConflict(null)}
        />
      )}

      <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="text-center text-xs py-6" style={{ color: "var(--ctp-overlay0)" }}>
            No commands match "{query}"
          </div>
        ) : grouped.map(({ category, commands }) => (
          <div key={category} className="flex flex-col gap-1">
            <div
              className="text-[10px] uppercase tracking-wider px-1"
              style={{ color: "var(--ctp-overlay1)" }}
            >
              {CATEGORY_LABEL[category]}
            </div>
            {commands.map((cmd) => (
              <KeybindingRow
                key={cmd.id}
                command={cmd}
                keybindings={keybindings}
                isRecording={recordingId === cmd.id}
                onRecord={() => setRecordingId(cmd.id)}
                onRecorderCommit={(ks) => handleRecorderCommit(cmd.id, ks)}
                onRecorderCancel={() => setRecordingId(null)}
                onUnbind={() => setBinding(cmd.id, null)}
                onReset={() => resetBinding(cmd.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeybindingRow({
  command,
  keybindings,
  isRecording,
  onRecord,
  onRecorderCommit,
  onRecorderCancel,
  onUnbind,
  onReset,
}: {
  command: Command;
  keybindings: Overrides;
  isRecording: boolean;
  onRecord: () => void;
  onRecorderCommit: (ks: string) => void;
  onRecorderCancel: () => void;
  onUnbind: () => void;
  onReset: () => void;
}) {
  const current = effectiveKeystrokeFor(command.id, keybindings);
  const hasOverride = command.id in keybindings;
  const isDefault = !hasOverride;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded"
      style={{ backgroundColor: "var(--ctp-mantle)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" style={{ color: "var(--ctp-text)" }}>
          {command.label}
        </div>
        <div className="text-[10px] font-mono truncate" style={{ color: "var(--ctp-overlay0)" }}>
          {command.id}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isRecording ? (
          <KeybindingRecorder onCommit={onRecorderCommit} onCancel={onRecorderCancel} />
        ) : (
          <div className="min-w-[80px] text-right">
            {current ? (
              <span
                className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                style={{ backgroundColor: "var(--ctp-surface0)", color: "var(--ctp-text)", letterSpacing: "0.15em" }}
              >
                {formatKeystroke(current)}
              </span>
            ) : (
              <span className="text-[11px] italic" style={{ color: "var(--ctp-overlay0)" }}>
                unbound
              </span>
            )}
          </div>
        )}
        {!isRecording && (
          <>
            <IconButton onClick={onRecord} title="Record new keybinding">
              <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="var(--ctp-red)" />
              </svg>
            </IconButton>
            <IconButton
              onClick={onUnbind}
              title={current ? "Clear keybinding" : "Already unbound"}
              disabled={!current}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </IconButton>
            <IconButton
              onClick={onReset}
              title={isDefault ? "Already at default" : "Reset to default"}
              disabled={isDefault}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <polyline points="3 3 3 9 9 9" />
              </svg>
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  title,
  children,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex items-center justify-center w-6 h-6 rounded transition-colors"
      style={{
        backgroundColor: "var(--ctp-surface1)",
        color: "var(--ctp-subtext0)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ConflictBanner({
  conflict,
  onReassign,
  onCancel,
}: {
  conflict: PendingConflict;
  onReassign: () => void;
  onCancel: () => void;
}) {
  const other = COMMANDS.find((c) => c.id === conflict.conflictingCommandId);
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded"
      style={{
        backgroundColor: "var(--ctp-surface1)",
        border: "1px solid var(--ctp-peach)",
      }}
    >
      <div className="flex-1 text-xs" style={{ color: "var(--ctp-text)" }}>
        <span className="font-mono" style={{ letterSpacing: "0.15em" }}>
          {formatKeystroke(conflict.keystroke)}
        </span>
        {" is already bound to "}
        <span className="font-semibold">{other?.label ?? conflict.conflictingCommandId}</span>
        {". Reassign?"}
      </div>
      <button
        onClick={onReassign}
        className="px-2 py-1 rounded text-xs font-semibold"
        style={{ backgroundColor: "var(--ctp-peach)", color: "var(--ctp-base)" }}
      >
        Reassign
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 rounded text-xs"
        style={{ color: "var(--ctp-subtext0)" }}
      >
        Cancel
      </button>
    </div>
  );
}
