import { useState, useEffect, useRef } from "react";
import type { CustomScript, ScriptParameter, ScriptRunMode } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { onScriptRun } from "../../state/rpc-client";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  repoPath: string;
  workspacePath: string;
  workspaceName: string;
  scripts: CustomScript[];
  disablePackageScripts: boolean;
  packageScripts: Array<{ name: string; command: string }>;
  hiddenPackageScripts: string[];
  packageScriptRunMode: Record<string, ScriptRunMode>;
  disableMavenScripts: boolean;
  mavenScripts: Array<{ name: string; command: string }>;
  hiddenMavenScripts: string[];
  mavenScriptRunMode: Record<string, ScriptRunMode>;
  disableGradleScripts: boolean;
  gradleScripts: Array<{ name: string; command: string }>;
  hiddenGradleScripts: string[];
  gradleScriptRunMode: Record<string, ScriptRunMode>;
  onChanged: (scripts: CustomScript[]) => void;
  onDisablePackageScriptsChanged: (disabled: boolean) => void;
  onHiddenPackageScriptsChanged: (hidden: string[]) => void;
  onPackageScriptRunModeChanged: (modes: Record<string, ScriptRunMode>) => void;
  onDisableMavenScriptsChanged: (disabled: boolean) => void;
  onHiddenMavenScriptsChanged: (hidden: string[]) => void;
  onMavenScriptRunModeChanged: (modes: Record<string, ScriptRunMode>) => void;
  onDisableGradleScriptsChanged: (disabled: boolean) => void;
  onHiddenGradleScriptsChanged: (hidden: string[]) => void;
  onGradleScriptRunModeChanged: (modes: Record<string, ScriptRunMode>) => void;
  onDismiss: () => void;
}

export function ScriptDialog({
  repoPath,
  workspacePath,
  workspaceName,
  scripts,
  disablePackageScripts,
  packageScripts,
  hiddenPackageScripts,
  packageScriptRunMode,
  disableMavenScripts,
  mavenScripts,
  hiddenMavenScripts,
  mavenScriptRunMode,
  disableGradleScripts,
  gradleScripts,
  hiddenGradleScripts,
  gradleScriptRunMode,
  onChanged,
  onDisablePackageScriptsChanged,
  onHiddenPackageScriptsChanged,
  onPackageScriptRunModeChanged,
  onDisableMavenScriptsChanged,
  onHiddenMavenScriptsChanged,
  onMavenScriptRunModeChanged,
  onDisableGradleScriptsChanged,
  onHiddenGradleScriptsChanged,
  onGradleScriptRunModeChanged,
  onDismiss,
}: Props) {
  useOverlay();

  // Form state — used for both add and edit
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = adding new
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"inline" | "file">("inline");
  const [script, setScript] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [parameters, setParameters] = useState<ScriptParameter[]>([]);
  const [showOutput, setShowOutput] = useState(false);
  const [runMode, setRunMode] = useState<ScriptRunMode>("modal");
  const [saving, setSaving] = useState(false);

  // Test run state
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState("");
  const [testExitCode, setTestExitCode] = useState<number | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (editing) setTimeout(() => nameRef.current?.focus(), 0);
  }, [editing]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [testOutput]);

  const persistScripts = async (updated: CustomScript[]) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      customScripts: updated,
    });
    onChanged(updated);
  };

  const persistPackageRunModes = async (modes: Record<string, ScriptRunMode>) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      packageScriptRunMode: modes,
    });
    onPackageScriptRunModeChanged(modes);
  };

  const persistHiddenScripts = async (hidden: string[]) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      hiddenPackageScripts: hidden,
    });
    onHiddenPackageScriptsChanged(hidden);
  };

  const persistMavenRunModes = async (modes: Record<string, ScriptRunMode>) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      mavenScriptRunMode: modes,
    });
    onMavenScriptRunModeChanged(modes);
  };

  const persistHiddenMavenScripts = async (hidden: string[]) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      hiddenMavenScripts: hidden,
    });
    onHiddenMavenScriptsChanged(hidden);
  };

  const persistGradleRunModes = async (modes: Record<string, ScriptRunMode>) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      gradleScriptRunMode: modes,
    });
    onGradleScriptRunModeChanged(modes);
  };

  const persistHiddenGradleScripts = async (hidden: string[]) => {
    const settings = await api.getRepoSettings(repoPath);
    await api.saveRepoSettings(repoPath, {
      ...settings,
      hiddenGradleScripts: hidden,
    });
    onHiddenGradleScriptsChanged(hidden);
  };

  const handleDelete = async (id: string) => {
    await persistScripts(scripts.filter((s) => s.id !== id));
  };

  const resetForm = () => {
    setName("");
    setScript("");
    setScriptPath("");
    setMode("inline");
    setParameters([]);
    setShowOutput(false);
    setRunMode("modal");
    setTestOutput("");
    setTestExitCode(null);
    setEditing(false);
    setEditingId(null);
  };

  const openEdit = (cs: CustomScript) => {
    setEditingId(cs.id);
    setName(cs.name);
    setScript(cs.script);
    setScriptPath(cs.scriptPath ?? "");
    setMode(cs.scriptPath ? "file" : "inline");
    setParameters(cs.parameters ?? []);
    setShowOutput(cs.showOutput ?? false);
    setRunMode(cs.runMode ?? "modal");
    setTestOutput("");
    setTestExitCode(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const savedScript: CustomScript = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      script: mode === "inline" ? script : "",
      scriptPath: mode === "file" ? scriptPath : undefined,
      parameters: parameters.length > 0 ? parameters : undefined,
      showOutput,
      runMode: runMode === "modal" ? undefined : runMode,
    };

    if (editingId) {
      // Replace existing
      await persistScripts(scripts.map((s) => (s.id === editingId ? savedScript : s)));
    } else {
      // Append new
      await persistScripts([...scripts, savedScript]);
    }
    resetForm();
    setSaving(false);
  };

  const handleTestRun = async () => {
    setTesting(true);
    setTestOutput("");
    setTestExitCode(null);
    const { runId } = await api.runCustomScript({
      repoPath,
      workspacePath,
      workspaceName,
      script: mode === "inline" ? script : undefined,
      scriptPath: mode === "file" ? scriptPath : undefined,
    });
    onScriptRun(
      runId,
      (data) => setTestOutput((prev) => prev + data),
      (exitCode) => {
        setTestExitCode(exitCode);
        setTesting(false);
      },
    );
  };

  const handleBrowse = async () => {
    const result = await api.browseFile(repoPath);
    if (result.path) {
      setScriptPath(result.path);
      setTestOutput("");
      setTestExitCode(null);
    }
  };

  const handleAddParam = () => {
    setParameters([...parameters, { name: "", displayName: "" }]);
  };

  const handleParamChange = (index: number, field: "name" | "displayName", value: string) => {
    setParameters(parameters.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const handleRemoveParam = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (editing) {
        resetForm();
      } else {
        onDismiss();
      }
    }
    if (e.key === "s" && e.metaKey && editing && canSave) {
      e.preventDefault();
      handleSave();
    }
  };

  const hasScript =
    mode === "inline" ? script.trim().length > 0 : scriptPath.trim().length > 0;
  const canTest = hasScript && !testing;
  const canSave = name.trim().length > 0 && hasScript && !saving
    && parameters.every((p) => p.name.trim().length > 0 && p.displayName.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onDismiss}
    >
      <div
        className="flex flex-col gap-4 rounded-xl p-6 shadow-2xl overflow-y-auto"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 520,
          maxHeight: "85vh",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <h2
          className="text-base font-bold text-center"
          style={{ color: "var(--ctp-text)" }}
        >
          Manage Scripts
        </h2>

        {/* Auto-detect toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!disablePackageScripts}
            onChange={async (e) => {
              const disabled = !e.target.checked;
              const settings = await api.getRepoSettings(repoPath);
              await api.saveRepoSettings(repoPath, { ...settings, disablePackageScripts: disabled });
              onDisablePackageScriptsChanged(disabled);
            }}
            className="accent-[var(--ctp-blue)]"
          />
          <span className="text-xs" style={{ color: "var(--ctp-text)" }}>
            Auto-detect scripts from package.json
          </span>
        </label>

        {/* Package scripts visibility */}
        {!disablePackageScripts && packageScripts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
                Package Scripts ({packageScripts.length})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => persistHiddenScripts([])}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Select All
                </button>
                <button
                  onClick={() => persistHiddenScripts(packageScripts.map((ps) => ps.name))}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div
              className="flex flex-col gap-0.5 overflow-y-auto rounded"
              style={{ maxHeight: 200, backgroundColor: "var(--ctp-surface0)", border: "1px solid var(--ctp-surface1)" }}
            >
              {packageScripts.map((ps) => {
                const isVisible = !hiddenPackageScripts.includes(ps.name);
                const mode = packageScriptRunMode[ps.name] ?? "modal";
                const inPane = mode === "bottomPane";
                return (
                  <div
                    key={ps.name}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--ctp-surface1)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => {
                        const updated = isVisible
                          ? [...hiddenPackageScripts, ps.name]
                          : hiddenPackageScripts.filter((n) => n !== ps.name);
                        persistHiddenScripts(updated);
                      }}
                      className="accent-[var(--ctp-blue)] shrink-0 cursor-pointer"
                      title={isVisible ? "Hide from menu" : "Show in menu"}
                    />
                    <span className="text-xs font-semibold truncate" style={{ color: "var(--ctp-text)" }}>
                      {ps.name}
                    </span>
                    <span className="text-[11px] font-mono truncate ml-auto" style={{ color: "var(--ctp-overlay0)" }}>
                      {ps.command}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...packageScriptRunMode };
                        if (inPane) delete next[ps.name];
                        else next[ps.name] = "bottomPane";
                        persistPackageRunModes(next);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
                      style={{
                        backgroundColor: inPane ? "var(--ctp-green)" : "var(--ctp-surface1)",
                        color: inPane ? "var(--ctp-base)" : "var(--ctp-subtext0)",
                      }}
                      title={
                        inPane
                          ? "Runs in the bottom Run pane. Click to switch to modal."
                          : "Runs in a modal dialog. Click to switch to the Run pane."
                      }
                    >
                      {inPane ? "Pane" : "Modal"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Maven auto-detect toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!disableMavenScripts}
            onChange={async (e) => {
              const disabled = !e.target.checked;
              const settings = await api.getRepoSettings(repoPath);
              await api.saveRepoSettings(repoPath, { ...settings, disableMavenScripts: disabled });
              onDisableMavenScriptsChanged(disabled);
            }}
            className="accent-[var(--ctp-blue)]"
          />
          <span className="text-xs" style={{ color: "var(--ctp-text)" }}>
            Auto-detect scripts from pom.xml
          </span>
        </label>

        {/* Maven scripts visibility */}
        {!disableMavenScripts && mavenScripts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
                Maven Scripts ({mavenScripts.length})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => persistHiddenMavenScripts([])}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Select All
                </button>
                <button
                  onClick={() => persistHiddenMavenScripts(mavenScripts.map((ms) => ms.name))}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div
              className="flex flex-col gap-0.5 overflow-y-auto rounded"
              style={{ maxHeight: 200, backgroundColor: "var(--ctp-surface0)", border: "1px solid var(--ctp-surface1)" }}
            >
              {mavenScripts.map((ms) => {
                const isVisible = !hiddenMavenScripts.includes(ms.name);
                const mode = mavenScriptRunMode[ms.name] ?? "modal";
                const inPane = mode === "bottomPane";
                return (
                  <div
                    key={ms.name}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--ctp-surface1)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => {
                        const updated = isVisible
                          ? [...hiddenMavenScripts, ms.name]
                          : hiddenMavenScripts.filter((n) => n !== ms.name);
                        persistHiddenMavenScripts(updated);
                      }}
                      className="accent-[var(--ctp-blue)] shrink-0 cursor-pointer"
                      title={isVisible ? "Hide from menu" : "Show in menu"}
                    />
                    <span className="text-xs font-semibold truncate" style={{ color: "var(--ctp-text)" }}>
                      {ms.name}
                    </span>
                    <span className="text-[11px] font-mono truncate ml-auto" style={{ color: "var(--ctp-overlay0)" }}>
                      {ms.command}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...mavenScriptRunMode };
                        if (inPane) delete next[ms.name];
                        else next[ms.name] = "bottomPane";
                        persistMavenRunModes(next);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
                      style={{
                        backgroundColor: inPane ? "var(--ctp-green)" : "var(--ctp-surface1)",
                        color: inPane ? "var(--ctp-base)" : "var(--ctp-subtext0)",
                      }}
                      title={
                        inPane
                          ? "Runs in the bottom Run pane. Click to switch to modal."
                          : "Runs in a modal dialog. Click to switch to the Run pane."
                      }
                    >
                      {inPane ? "Pane" : "Modal"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Gradle auto-detect toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!disableGradleScripts}
            onChange={async (e) => {
              const disabled = !e.target.checked;
              const settings = await api.getRepoSettings(repoPath);
              await api.saveRepoSettings(repoPath, { ...settings, disableGradleScripts: disabled });
              onDisableGradleScriptsChanged(disabled);
            }}
            className="accent-[var(--ctp-blue)]"
          />
          <span className="text-xs" style={{ color: "var(--ctp-text)" }}>
            Auto-detect scripts from build.gradle
          </span>
        </label>

        {/* Gradle scripts visibility */}
        {!disableGradleScripts && gradleScripts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
                Gradle Scripts ({gradleScripts.length})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => persistHiddenGradleScripts([])}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Select All
                </button>
                <button
                  onClick={() => persistHiddenGradleScripts(gradleScripts.map((gs) => gs.name))}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div
              className="flex flex-col gap-0.5 overflow-y-auto rounded"
              style={{ maxHeight: 200, backgroundColor: "var(--ctp-surface0)", border: "1px solid var(--ctp-surface1)" }}
            >
              {gradleScripts.map((gs) => {
                const isVisible = !hiddenGradleScripts.includes(gs.name);
                const mode = gradleScriptRunMode[gs.name] ?? "modal";
                const inPane = mode === "bottomPane";
                return (
                  <div
                    key={gs.name}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--ctp-surface1)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => {
                        const updated = isVisible
                          ? [...hiddenGradleScripts, gs.name]
                          : hiddenGradleScripts.filter((n) => n !== gs.name);
                        persistHiddenGradleScripts(updated);
                      }}
                      className="accent-[var(--ctp-blue)] shrink-0 cursor-pointer"
                      title={isVisible ? "Hide from menu" : "Show in menu"}
                    />
                    <span className="text-xs font-semibold truncate" style={{ color: "var(--ctp-text)" }}>
                      {gs.name}
                    </span>
                    <span className="text-[11px] font-mono truncate ml-auto" style={{ color: "var(--ctp-overlay0)" }}>
                      {gs.command}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...gradleScriptRunMode };
                        if (inPane) delete next[gs.name];
                        else next[gs.name] = "bottomPane";
                        persistGradleRunModes(next);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
                      style={{
                        backgroundColor: inPane ? "var(--ctp-green)" : "var(--ctp-surface1)",
                        color: inPane ? "var(--ctp-base)" : "var(--ctp-subtext0)",
                      }}
                      title={
                        inPane
                          ? "Runs in the bottom Run pane. Click to switch to modal."
                          : "Runs in a modal dialog. Click to switch to the Run pane."
                      }
                    >
                      {inPane ? "Pane" : "Modal"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Script list */}
        <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 200 }}>
          {scripts.length === 0 && !editing && (
            <p
              className="text-xs text-center py-3"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              No scripts yet.
            </p>
          )}
          {scripts.map((cs) => (
            <div
              key={cs.id}
              className="flex items-center gap-2 px-3 py-2 rounded"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                border: "1px solid var(--ctp-surface1)",
              }}
            >
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-semibold truncate"
                  style={{ color: "var(--ctp-text)" }}
                >
                  {cs.name}
                </div>
                <div
                  className="text-[11px] font-mono truncate"
                  style={{ color: "var(--ctp-overlay0)" }}
                >
                  {cs.scriptPath || cs.script}
                  {cs.parameters && cs.parameters.length > 0 && (
                    <span style={{ color: "var(--ctp-blue)" }}>
                      {" "}({cs.parameters.map((p) => p.displayName || p.name).join(", ")})
                    </span>
                  )}
                  {cs.showOutput && (
                    <span style={{ color: "var(--ctp-green)" }}> [output]</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => openEdit(cs)}
                className="px-2 py-1 rounded text-xs font-semibold transition-colors shrink-0"
                style={{ color: "var(--ctp-blue)" }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(cs.id)}
                className="px-2 py-1 rounded text-xs font-semibold transition-colors shrink-0"
                style={{ color: "var(--ctp-red)" }}
                title={`Delete "${cs.name}"`}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        {/* Add / Edit form */}
        {editing ? (
          <div
            className="flex flex-col gap-3 p-4 rounded-lg"
            style={{
              backgroundColor: "var(--ctp-mantle)",
              border: "1px solid var(--ctp-surface0)",
            }}
          >
            {/* Name */}
            <div className="flex flex-col gap-1">
              <label
                className="text-[11px] font-semibold"
                style={{ color: "var(--ctp-subtext0)" }}
              >
                Script name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lint & Fix"
                className="px-3 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: "var(--ctp-surface0)",
                  color: "var(--ctp-text)",
                  border: "1px solid var(--ctp-surface1)",
                }}
              />
            </div>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setMode("inline"); setTestOutput(""); setTestExitCode(null); }}
                className="px-3 py-1 rounded text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: mode === "inline" ? "var(--ctp-surface1)" : "var(--ctp-surface0)",
                  color: mode === "inline" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
                }}
              >
                Write Script
              </button>
              <button
                onClick={() => { setMode("file"); setTestOutput(""); setTestExitCode(null); }}
                className="px-3 py-1 rounded text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: mode === "file" ? "var(--ctp-surface1)" : "var(--ctp-surface0)",
                  color: mode === "file" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
                }}
              >
                Link Script File
              </button>
            </div>

            {/* Script input */}
            {mode === "inline" ? (
              <textarea
                value={script}
                onChange={(e) => { setScript(e.target.value); setTestOutput(""); setTestExitCode(null); }}
                placeholder="e.g. npm run lint -- --fix"
                rows={4}
                spellCheck={false}
                className="px-3 py-2 rounded text-sm font-mono outline-none resize-none"
                style={{
                  backgroundColor: "var(--ctp-surface0)",
                  color: "var(--ctp-text)",
                  border: "1px solid var(--ctp-surface1)",
                }}
              />
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scriptPath}
                  onChange={(e) => { setScriptPath(e.target.value); setTestOutput(""); setTestExitCode(null); }}
                  placeholder="/path/to/script.sh"
                  className="flex-1 px-3 py-2 rounded text-sm font-mono outline-none"
                  style={{
                    backgroundColor: "var(--ctp-surface0)",
                    color: "var(--ctp-text)",
                    border: "1px solid var(--ctp-surface1)",
                  }}
                />
                <button
                  onClick={handleBrowse}
                  className="px-3 py-2 rounded text-xs font-semibold transition-colors"
                  style={{ backgroundColor: "var(--ctp-surface1)", color: "var(--ctp-text)" }}
                >
                  Browse...
                </button>
              </div>
            )}

            {/* Parameters */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  className="text-[11px] font-semibold"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  Parameters
                </label>
                <button
                  onClick={handleAddParam}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: "var(--ctp-blue)" }}
                >
                  + Add
                </button>
              </div>
              {parameters.length === 0 && (
                <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
                  No parameters. Values will be available as environment variables.
                </p>
              )}
              {parameters.map((param, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={param.displayName}
                    onChange={(e) => handleParamChange(i, "displayName", e.target.value)}
                    placeholder="Display Name"
                    className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                    style={{
                      backgroundColor: "var(--ctp-surface0)",
                      color: "var(--ctp-text)",
                      border: "1px solid var(--ctp-surface1)",
                    }}
                  />
                  <input
                    type="text"
                    value={param.name}
                    onChange={(e) => handleParamChange(i, "name", e.target.value)}
                    placeholder="ENV_VAR"
                    className="flex-1 px-2 py-1.5 rounded text-xs font-mono outline-none"
                    style={{
                      backgroundColor: "var(--ctp-surface0)",
                      color: "var(--ctp-text)",
                      border: "1px solid var(--ctp-surface1)",
                    }}
                  />
                  <button
                    onClick={() => handleRemoveParam(i)}
                    className="text-[11px] transition-colors"
                    style={{ color: "var(--ctp-red)" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {/* Show output toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOutput}
                onChange={(e) => setShowOutput(e.target.checked)}
                className="accent-[var(--ctp-blue)]"
              />
              <span className="text-xs" style={{ color: "var(--ctp-text)" }}>
                Show output when running
              </span>
            </label>

            {/* Run mode selector */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
                Run in
              </span>
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--ctp-text)" }}>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="runMode"
                    value="modal"
                    checked={runMode === "modal"}
                    onChange={() => setRunMode("modal")}
                    className="accent-[var(--ctp-blue)]"
                  />
                  <span>Modal dialog</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="runMode"
                    value="bottomPane"
                    checked={runMode === "bottomPane"}
                    onChange={() => setRunMode("bottomPane")}
                    className="accent-[var(--ctp-blue)]"
                  />
                  <span>Run pane (for long-running scripts)</span>
                </label>
              </div>
            </div>

            {/* Test Run */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestRun}
                disabled={!canTest}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
                style={{
                  backgroundColor: canTest ? "var(--ctp-surface1)" : "var(--ctp-surface0)",
                  color: canTest ? "var(--ctp-text)" : "var(--ctp-overlay0)",
                  cursor: canTest ? "pointer" : "not-allowed",
                  opacity: canTest ? 1 : 0.5,
                }}
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2l10 6-10 6V2z" />
                </svg>
                {testing ? "Running..." : "Test Run"}
              </button>
              {testExitCode !== null && !testing && (
                <span
                  className="text-xs font-semibold"
                  style={{ color: testExitCode === 0 ? "var(--ctp-green)" : "var(--ctp-red)" }}
                >
                  {testExitCode === 0 ? "Success" : `Failed (exit ${testExitCode})`}
                </span>
              )}
            </div>

            {testOutput && (
              <pre
                ref={outputRef}
                className="px-3 py-2 rounded text-[11px] font-mono overflow-auto max-h-32 whitespace-pre-wrap"
                style={{
                  backgroundColor: "var(--ctp-surface0)",
                  color: "var(--ctp-subtext0)",
                  border: "1px solid var(--ctp-surface1)",
                }}
              >
                {testOutput}
              </pre>
            )}

            {/* Form buttons */}
            <div className="flex justify-end gap-2">
              <button
                onClick={resetForm}
                className="px-3 py-1.5 rounded text-sm transition-colors"
                style={{ color: "var(--ctp-overlay1)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
                style={{
                  backgroundColor: canSave ? "var(--ctp-blue)" : "var(--ctp-surface1)",
                  color: canSave ? "var(--ctp-base)" : "var(--ctp-overlay0)",
                  cursor: canSave ? "pointer" : "not-allowed",
                }}
              >
                {saving ? "Saving..." : editingId ? "Save Changes" : "Add Script"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditingId(null); setEditing(true); }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add New Script
          </button>
        )}

        {/* Close */}
        <div className="flex justify-end mt-1">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded text-sm font-semibold transition-colors"
            style={{ backgroundColor: "var(--ctp-surface1)", color: "var(--ctp-text)" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
