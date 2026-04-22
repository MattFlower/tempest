import { useMemo, useState } from "react";
import {
  COMMANDS,
  effectiveKeystrokeFor,
  type Command,
  type CommandCategory,
} from "../../commands/registry";
import { formatKeystroke } from "../../keybindings/keystroke";
import { useStore } from "../../state/store";

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
        {grouped.length === 0 ? (
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
          </div>
        )}
      </div>
    </div>
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
