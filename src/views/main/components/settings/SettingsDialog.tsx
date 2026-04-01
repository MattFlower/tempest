// ============================================================
// SettingsDialog — global application settings.
// Currently supports choosing the default file editor
// (Neovim or Monaco).
// ============================================================

import { useState, useEffect } from "react";
import type { AppConfig } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";

export function SettingsDialog() {
  const toggleSettingsDialog = useStore((s) => s.toggleSettingsDialog);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editor, setEditor] = useState<"nvim" | "monaco">("nvim");
  const [vimMode, setVimMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then((cfg: AppConfig) => {
      setConfig(cfg);
      setEditor(cfg.editor === "monaco" ? "monaco" : "nvim");
      setVimMode(cfg.monacoVimMode ?? false);
    });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const updated = { ...config, editor, monacoVimMode: vimMode };
    await api.saveConfig(updated);
    setSaving(false);
    toggleSettingsDialog();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      toggleSettingsDialog();
    }
    if (e.key === "s" && e.metaKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const isDirty = config
    ? (config.editor ?? "nvim") !== editor || (config.monacoVimMode ?? false) !== vimMode
    : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={toggleSettingsDialog}
    >
      <div
        className="flex flex-col gap-5 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 400,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <div className="text-center">
          <h2
            className="text-base font-bold"
            style={{ color: "var(--ctp-text)" }}
          >
            Settings
          </h2>
        </div>

        {!config ? (
          <div
            className="text-center text-sm py-4"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Loading...
          </div>
        ) : (
          <>
            {/* Default Editor */}
            <div className="flex flex-col gap-2">
              <label
                className="text-[11px] font-semibold"
                style={{ color: "var(--ctp-subtext0)" }}
              >
                Default File Editor
              </label>
              <p
                className="text-[11px]"
                style={{ color: "var(--ctp-overlay0)" }}
              >
                Choose which editor opens when you select a file.
              </p>

              {/* Segmented control */}
              <div
                className="flex rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--ctp-surface1)" }}
              >
                <button
                  onClick={() => setEditor("nvim")}
                  className="flex-1 py-2 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor:
                      editor === "nvim"
                        ? "var(--ctp-surface1)"
                        : "var(--ctp-surface0)",
                    color:
                      editor === "nvim"
                        ? "var(--ctp-text)"
                        : "var(--ctp-overlay0)",
                  }}
                >
                  Neovim
                </button>
                <div
                  className="w-px"
                  style={{ backgroundColor: "var(--ctp-surface1)" }}
                />
                <button
                  onClick={() => setEditor("monaco")}
                  className="flex-1 py-2 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor:
                      editor === "monaco"
                        ? "var(--ctp-surface1)"
                        : "var(--ctp-surface0)",
                    color:
                      editor === "monaco"
                        ? "var(--ctp-text)"
                        : "var(--ctp-overlay0)",
                  }}
                >
                  Monaco
                </button>
              </div>
            </div>

            {/* Vim Mode */}
            <div
              className="flex items-center justify-between gap-3 py-1"
            >
              <div className="flex flex-col gap-0.5">
                <label
                  className="text-[11px] font-semibold"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  Vim Keybindings
                </label>
                <p
                  className="text-[11px]"
                  style={{ color: "var(--ctp-overlay0)" }}
                >
                  Enable vim keybindings in the Monaco editor.
                </p>
              </div>
              <button
                onClick={() => setVimMode(!vimMode)}
                className="relative flex-shrink-0 rounded-full transition-colors"
                style={{
                  width: 36,
                  height: 20,
                  backgroundColor: vimMode
                    ? "var(--ctp-green)"
                    : "var(--ctp-surface1)",
                }}
              >
                <div
                  className="absolute top-0.5 rounded-full transition-transform"
                  style={{
                    width: 16,
                    height: 16,
                    backgroundColor: "var(--ctp-text)",
                    transform: vimMode ? "translateX(18px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>
          </>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={toggleSettingsDialog}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !config}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor:
                isDirty && !saving ? "var(--ctp-blue)" : "var(--ctp-surface1)",
              color:
                isDirty && !saving ? "var(--ctp-base)" : "var(--ctp-overlay0)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
