// ============================================================
// FormattingTab — global formatter system controls.
//
// Three sections:
//   1. Save actions: formatOnSave + trim trailing whitespace + insert
//      final newline. The first is part of FormattingConfig; the two
//      cleanup toggles are EditorSaveActionsConfig (separate so users
//      can opt into cleanup without committing to format-on-save).
//   2. Default formatter: optional global override that forces a
//      specific provider id for all languages.
//   3. Per-language overrides: a list of (language → forced
//      defaultFormatter) entries. Adding a row prompts for a Monaco
//      language id; removing one drops it from the map.
//
// Per-repo overrides live on the workspace status pane, not here —
// global only.
// ============================================================

import { useEffect, useState } from "react";
import type {
  EditorSaveActionsConfig,
  FormattingConfig,
  LanguageFormattingConfig,
} from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";

const COMMON_LANGUAGES = [
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "go",
  "rust",
  "json",
  "html",
  "css",
  "markdown",
  "yaml",
  "shell",
  "c",
  "cpp",
];

interface FormatterEntry {
  id: string;
  displayName: string;
}

export function FormattingTab({
  formatting,
  setFormatting,
  saveActions,
  setSaveActions,
}: {
  formatting: FormattingConfig | undefined;
  setFormatting: (next: FormattingConfig | undefined) => void;
  saveActions: EditorSaveActionsConfig | undefined;
  setSaveActions: (next: EditorSaveActionsConfig | undefined) => void;
}) {
  // Per-language list of eligible formatters. A formatter is "eligible"
  // for a language when it has that language id in its static `languages`
  // array — runtime applies() (which depends on the specific file path)
  // is NOT consulted here, since users configure settings without a file
  // open. The picker filters by language so we don't offer (e.g.) gofmt
  // for python.
  const [byLanguage, setByLanguage] = useState<Record<string, FormatterEntry[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, FormatterEntry[]> = {};
      for (const lang of COMMON_LANGUAGES) {
        const r = await api.listFormattersForLanguage({ languageId: lang });
        out[lang] = r.formatters.map((f: { id: string; displayName: string }) => ({
          id: f.id,
          displayName: f.displayName,
        }));
      }
      if (!cancelled) setByLanguage(out);
    })();
    return () => { cancelled = true; };
  }, []);

  // For the global "Default Formatter" we show only formatters that
  // could plausibly serve as a universal default — meaning they cover
  // multiple languages. Single-language tools (gofmt, rustfmt, etc.)
  // are nonsensical as a global default, so we exclude them.
  const globalCandidates: FormatterEntry[] = (() => {
    const counts = new Map<string, { entry: FormatterEntry; languages: number }>();
    for (const list of Object.values(byLanguage)) {
      for (const f of list) {
        const slot = counts.get(f.id);
        if (slot) slot.languages += 1;
        else counts.set(f.id, { entry: f, languages: 1 });
      }
    }
    return [...counts.values()]
      .filter((x) => x.languages >= 2)
      .map((x) => x.entry)
      .sort((a, b) => a.id.localeCompare(b.id));
  })();

  const fmt = formatting ?? {};
  const sa = saveActions ?? {};
  const langs = fmt.languages ?? {};

  const setFmt = (patch: Partial<FormattingConfig>) => {
    const next = { ...fmt, ...patch };
    // Drop empty objects so the on-disk config stays clean.
    if (Object.keys(next).length === 0) setFormatting(undefined);
    else setFormatting(next);
  };

  const setLang = (lang: string, patch: Partial<LanguageFormattingConfig> | null) => {
    const nextLangs = { ...langs };
    if (patch === null) {
      delete nextLangs[lang];
    } else {
      const merged = { ...(nextLangs[lang] ?? {}), ...patch };
      // Drop the language entry entirely when no fields remain.
      if (Object.keys(merged).length === 0) delete nextLangs[lang];
      else nextLangs[lang] = merged;
    }
    if (Object.keys(nextLangs).length === 0) {
      const { languages: _omit, ...rest } = fmt;
      void _omit;
      setFormatting(Object.keys(rest).length === 0 ? undefined : rest);
    } else {
      setFmt({ languages: nextLangs });
    }
  };

  const setSA = (patch: Partial<EditorSaveActionsConfig>) => {
    const next = { ...sa, ...patch };
    if (Object.keys(next).length === 0) setSaveActions(undefined);
    else setSaveActions(next);
  };

  return (
    <>
      <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
        Tempest's formatter routes <em>Format Document</em> and (when
        enabled) save through Prettier, gofmt, rustfmt, and other
        external tools — falling back to LSP and Monaco's bundled
        formatter when nothing else applies.
      </p>

      {/* --- Save actions --- */}
      <div className="flex flex-col gap-3 mt-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ctp-overlay1)" }}>
          On Save
        </h3>
        <ToggleRow
          label="Format on save"
          description="Run the resolved formatter on the buffer before writing to disk. Failures don't block the save."
          value={fmt.formatOnSave === true}
          onChange={(v) => setFmt({ formatOnSave: v || undefined })}
        />
        <ToggleRow
          label="Format on paste"
          description="Run the resolved formatter on the inserted range immediately after pasting. Useful for keeping pasted snippets in your project's style."
          value={fmt.formatOnPaste === true}
          onChange={(v) => setFmt({ formatOnPaste: v || undefined })}
        />
        <ToggleRow
          label="Trim trailing whitespace"
          description="Strip trailing spaces and tabs from every line on save. Overridden per-file by .editorconfig when present."
          value={sa.trimTrailingWhitespace === true}
          onChange={(v) => setSA({ trimTrailingWhitespace: v || undefined })}
        />
        <ToggleRow
          label="Ensure final newline"
          description="Append a trailing newline if the last line doesn't already end with one. Overridden per-file by .editorconfig when present."
          value={sa.insertFinalNewline === true}
          onChange={(v) => setSA({ insertFinalNewline: v || undefined })}
        />
      </div>

      {/* --- Default formatter --- */}
      <div className="flex flex-col gap-2 mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ctp-overlay1)" }}>
          Default Formatter
        </h3>
        <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
          When set, every language uses this provider unconditionally
          (skipping the resolution order). Leave empty to let Tempest
          pick automatically.
        </p>
        <FormatterPicker
          formatters={globalCandidates}
          value={fmt.defaultFormatter ?? ""}
          onChange={(v) => setFmt({ defaultFormatter: v || undefined })}
        />
      </div>

      {/* --- Per-language overrides --- */}
      <div className="flex flex-col gap-2 mt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ctp-overlay1)" }}>
          Per-Language Overrides
        </h3>
        <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
          Force a specific formatter for one language id, regardless of
          the global default or project config.
        </p>
        <PerLanguageList
          byLanguage={byLanguage}
          languages={langs}
          onChange={(lang, patch) => setLang(lang, patch)}
        />
      </div>
    </>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex flex-col gap-0.5">
        <label className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
          {label}
        </label>
        <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
          {description}
        </p>
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative flex-shrink-0 rounded-full transition-colors"
      style={{
        width: 36,
        height: 20,
        backgroundColor: value ? "var(--ctp-green)" : "var(--ctp-surface1)",
      }}
    >
      <div
        className="absolute top-0.5 rounded-full transition-transform"
        style={{
          width: 16,
          height: 16,
          backgroundColor: "var(--ctp-text)",
          transform: value ? "translateX(18px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

function FormatterPicker({
  formatters,
  value,
  onChange,
}: {
  formatters: FormatterEntry[];
  value: string;
  onChange: (v: string) => void;
}) {
  // If the currently-selected value isn't in the eligible list (e.g. an
  // older config holds a formatter id that no longer exists or no
  // longer supports this language), include it as a stale entry so the
  // user can see it and clear it explicitly. Without this, switching
  // to "(auto)" would happen silently the first time the dialog opened.
  const showStale = value !== "" && !formatters.some((f) => f.id === value);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs rounded px-2 py-1.5"
      style={{
        backgroundColor: "var(--ctp-surface0)",
        color: "var(--ctp-text)",
        border: "1px solid var(--ctp-surface1)",
        width: 240,
      }}
    >
      <option value="">(auto)</option>
      {formatters.map((f) => (
        <option key={f.id} value={f.id}>
          {f.displayName} ({f.id})
        </option>
      ))}
      {showStale && (
        <option key={value} value={value}>
          {value} — not eligible
        </option>
      )}
    </select>
  );
}

function PerLanguageList({
  byLanguage,
  languages,
  onChange,
}: {
  byLanguage: Record<string, FormatterEntry[]>;
  languages: Record<string, LanguageFormattingConfig>;
  onChange: (lang: string, patch: Partial<LanguageFormattingConfig> | null) => void;
}) {
  // Adding a new override only makes sense for languages that have at
  // least one eligible formatter. Filter the "+ Add Language" dropdown
  // to those, and skip languages already in the override list.
  const addableLanguages = COMMON_LANGUAGES.filter(
    (l) => !(l in languages) && (byLanguage[l]?.length ?? 0) > 0,
  );
  const [draftLang, setDraftLang] = useState<string>(addableLanguages[0] ?? "typescript");
  // Keep draftLang valid as the addable list shrinks (when languages are added).
  useEffect(() => {
    if (!addableLanguages.includes(draftLang) && addableLanguages.length > 0) {
      setDraftLang(addableLanguages[0]!);
    }
  }, [addableLanguages, draftLang]);

  const entries = Object.entries(languages);

  return (
    <div className="flex flex-col gap-1.5">
      {entries.length === 0 && (
        <p className="text-[11px] italic" style={{ color: "var(--ctp-overlay0)" }}>
          No per-language overrides configured.
        </p>
      )}
      {entries.map(([lang, cfg]) => (
        <div key={lang} className="flex items-center gap-2">
          <code
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ backgroundColor: "var(--ctp-surface0)", color: "var(--ctp-text)" }}
          >
            {lang}
          </code>
          <FormatterPicker
            formatters={byLanguage[lang] ?? []}
            value={cfg.defaultFormatter ?? ""}
            onChange={(v) => onChange(lang, { defaultFormatter: v || undefined })}
          />
          <button
            onClick={() => onChange(lang, null)}
            className="text-[11px] px-2 py-1 rounded"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-red)",
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {addableLanguages.length > 0 ? (
        <div className="flex items-center gap-2 mt-1">
          <select
            value={draftLang}
            onChange={(e) => setDraftLang(e.target.value)}
            className="text-xs rounded px-2 py-1.5"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
              width: 160,
            }}
          >
            {addableLanguages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!draftLang) return;
              if (draftLang in languages) return;
              onChange(draftLang, { defaultFormatter: "" });
            }}
            className="text-[11px] px-3 py-1.5 rounded font-semibold"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
            }}
          >
            + Add Language
          </button>
        </div>
      ) : (
        <p className="text-[11px] italic mt-1" style={{ color: "var(--ctp-overlay0)" }}>
          No more languages with eligible formatters.
        </p>
      )}
    </div>
  );
}
