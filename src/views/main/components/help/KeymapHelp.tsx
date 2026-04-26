import { useMemo, useState } from "react";
import {
  COMMANDS,
  effectiveKeystrokeFor,
  type Command,
  type CommandCategory,
} from "../../commands/registry";
import { formatKeystroke } from "../../keybindings/keystroke";
import { useStore } from "../../state/store";

// Vim-mode bindings registered by MonacoEditorPane. These aren't part of
// the customizable keybinding system — they're hardcoded `Vim.map` /
// `Vim.defineEx` calls, so they're surfaced here as a separate
// reference-only section that's only visible when vim mode is enabled.
type VimBinding = { keys: string; ex: string; description: string };

const VIM_BINDINGS: VimBinding[] = [
  { keys: ":w", ex: ":write", description: "Save file" },
  { keys: ":q", ex: ":quit", description: "Close tab" },
  { keys: ":wq", ex: ":wquit", description: "Save and close tab" },
  { keys: "gd", ex: ":def", description: "Go to definition" },
  { keys: "gr", ex: ":refs", description: "Find references" },
  { keys: "K", ex: ":hover", description: "Show hover docs" },
  { keys: "gO", ex: ":symbols", description: "Go to symbol in file (outline)" },
  { keys: "gK", ex: ":sighelp", description: "Trigger signature help" },
  { keys: "]d", ex: ":diagnext", description: "Next diagnostic" },
  { keys: "[d", ex: ":diagprev", description: "Previous diagnostic" },
  { keys: "]D", ex: ":diaglast", description: "Last diagnostic in file" },
  { keys: "[D", ex: ":diagfirst", description: "First diagnostic in file" },
  { keys: "<leader>cr", ex: ":rename", description: "Rename symbol" },
  { keys: "<leader>ca", ex: ":codeaction", description: "Code actions / quick fix" },
];

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
  "palette",
  "tabs",
  "panes",
  "view",
  "workspace",
  "repo",
  "claude",
  "github",
  "app",
  "help",
];

export function KeymapHelp() {
  const overrides = useStore((s) => s.config?.keybindings);
  const vimEnabled = useStore((s) => s.config?.monacoVimMode ?? false);
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCat = new Map<CommandCategory, Command[]>();
    for (const cmd of COMMANDS) {
      const keystroke = effectiveKeystrokeFor(cmd.id, overrides);
      if (!keystroke) continue;
      if (
        q &&
        !cmd.label.toLowerCase().includes(q) &&
        !cmd.id.toLowerCase().includes(q) &&
        !formatKeystroke(keystroke).toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = byCat.get(cmd.category) ?? [];
      list.push(cmd);
      byCat.set(cmd.category, list);
    }
    return CATEGORY_ORDER.filter((cat) => byCat.has(cat)).map((cat) => ({
      category: cat,
      commands: byCat.get(cat)!,
    }));
  }, [overrides, query]);

  const vimMatches = useMemo(() => {
    if (!vimEnabled) return [];
    const q = query.trim().toLowerCase();
    if (!q) return VIM_BINDINGS;
    return VIM_BINDINGS.filter(
      (b) =>
        b.description.toLowerCase().includes(q) ||
        b.keys.toLowerCase().includes(q) ||
        b.ex.toLowerCase().includes(q),
    );
  }, [vimEnabled, query]);

  const noResults = grouped.length === 0 && vimMatches.length === 0;

  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ backgroundColor: "var(--ctp-base)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
      >
        <div className="flex flex-col">
          <div className="text-sm font-semibold" style={{ color: "var(--ctp-text)" }}>
            Keyboard Shortcuts
          </div>
          <div className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            Customize in Settings → Keybindings (⌘,)
          </div>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter shortcuts…"
          className="ml-auto px-2 py-1.5 rounded text-sm outline-none w-64"
          style={{
            backgroundColor: "var(--ctp-surface1)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface2)",
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {noResults ? (
          <div
            className="text-center text-xs py-10"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            No shortcuts match "{query}"
          </div>
        ) : (
          <div className="flex flex-col gap-5 max-w-3xl mx-auto">
            {grouped.map(({ category, commands }) => (
              <CategorySection
                key={category}
                label={CATEGORY_LABEL[category]}
                commands={commands}
                overrides={overrides}
              />
            ))}
            {vimMatches.length > 0 && <VimSection bindings={vimMatches} />}
          </div>
        )}
      </div>
    </div>
  );
}

function VimSection({ bindings }: { bindings: VimBinding[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h2
        className="text-[10px] uppercase tracking-wider px-1 pb-1"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        Editor (Vim Mode)
      </h2>
      <div
        className="rounded overflow-hidden"
        style={{ backgroundColor: "var(--ctp-mantle)" }}
      >
        {bindings.map((b, i) => (
          <div
            key={b.ex}
            className="flex items-center gap-3 px-3 py-2"
            style={{
              borderTop: i === 0 ? "none" : "1px solid var(--ctp-surface0)",
            }}
          >
            <div
              className="flex-1 text-sm truncate"
              style={{ color: "var(--ctp-text)" }}
            >
              {b.description}
            </div>
            <span
              className="px-2 py-0.5 rounded text-[11px] font-mono"
              style={{
                backgroundColor: "var(--ctp-surface1)",
                color: "var(--ctp-subtext0)",
                letterSpacing: "0.05em",
              }}
            >
              {b.ex}
            </span>
            <span
              className="px-2 py-0.5 rounded text-[11px] font-mono"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                letterSpacing: "0.15em",
              }}
            >
              {b.keys}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategorySection({
  label,
  commands,
  overrides,
}: {
  label: string;
  commands: Command[];
  overrides: Record<string, string | null> | undefined;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2
        className="text-[10px] uppercase tracking-wider px-1 pb-1"
        style={{ color: "var(--ctp-overlay1)" }}
      >
        {label}
      </h2>
      <div
        className="rounded overflow-hidden"
        style={{ backgroundColor: "var(--ctp-mantle)" }}
      >
        {commands.map((cmd, i) => {
          const keystroke = effectiveKeystrokeFor(cmd.id, overrides);
          return (
            <div
              key={cmd.id}
              className="flex items-center gap-3 px-3 py-2"
              style={{
                borderTop:
                  i === 0 ? "none" : "1px solid var(--ctp-surface0)",
              }}
            >
              <div
                className="flex-1 text-sm truncate"
                style={{ color: "var(--ctp-text)" }}
              >
                {cmd.label}
              </div>
              {keystroke && (
                <span
                  className="px-2 py-0.5 rounded text-[11px] font-mono"
                  style={{
                    backgroundColor: "var(--ctp-surface0)",
                    color: "var(--ctp-text)",
                    letterSpacing: "0.15em",
                  }}
                >
                  {formatKeystroke(keystroke)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
