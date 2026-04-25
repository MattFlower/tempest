import { useState, useEffect, useRef } from "react";
import type { SourceRepo } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  repo: SourceRepo;
  onDismiss: () => void;
}

function ScriptSection({
  label,
  description,
  script,
  onScriptChange,
  onTestRun,
  testing,
  testResult,
}: {
  label: string;
  description: string;
  script: string;
  onScriptChange: (value: string) => void;
  onTestRun: () => void;
  testing: boolean;
  testResult: { exitCode: number; output: string } | null;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const canTest = script.trim().length > 0 && !testing;

  useEffect(() => {
    if (testResult && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [testResult]);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label
          className="text-[11px] font-semibold"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          {label}
        </label>
        <p
          className="text-[11px]"
          style={{ color: "var(--ctp-overlay0)" }}
        >
          {description}
        </p>
        <textarea
          value={script}
          onChange={(e) => onScriptChange(e.target.value)}
          placeholder="e.g. npm install"
          rows={5}
          spellCheck={false}
          className="px-3 py-2 rounded text-sm font-mono outline-none resize-none"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface1)",
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onTestRun}
            disabled={!canTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canTest
                ? "var(--ctp-surface1)"
                : "var(--ctp-surface0)",
              color: canTest
                ? "var(--ctp-text)"
                : "var(--ctp-overlay0)",
              cursor: canTest ? "pointer" : "not-allowed",
              opacity: canTest ? 1 : 0.5,
            }}
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
            {testing ? "Running..." : "Test Run"}
          </button>

          {testResult && !testing && (
            <span
              className="text-xs font-semibold flex items-center gap-1"
              style={{
                color:
                  testResult.exitCode === 0
                    ? "var(--ctp-green)"
                    : "var(--ctp-red)",
              }}
            >
              {testResult.exitCode === 0 ? (
                <>
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zm3.78-9.72a.75.75 0 0 0-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25z" />
                  </svg>
                  Success
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657zM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97z" />
                  </svg>
                  Failed (exit {testResult.exitCode})
                </>
              )}
            </span>
          )}
        </div>

        {testResult && testResult.output && (
          <pre
            ref={outputRef}
            className="px-3 py-2 rounded text-[11px] font-mono overflow-auto max-h-40 whitespace-pre-wrap"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-subtext0)",
              border: "1px solid var(--ctp-surface1)",
            }}
          >
            {testResult.output}
          </pre>
        )}
      </div>
    </>
  );
}

export function RepoSettingsDialog({ repo, onDismiss }: Props) {
  useOverlay();
  const [prepareScript, setPrepareScript] = useState("");
  const [archiveScript, setArchiveScript] = useState("");
  const [originalPrepareScript, setOriginalPrepareScript] = useState("");
  const [originalArchiveScript, setOriginalArchiveScript] = useState("");
  const [disableLsp, setDisableLsp] = useState(false);
  const [originalDisableLsp, setOriginalDisableLsp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prepareTestResult, setPrepareTestResult] = useState<{
    exitCode: number;
    output: string;
  } | null>(null);
  const [archiveTestResult, setArchiveTestResult] = useState<{
    exitCode: number;
    output: string;
  } | null>(null);
  const [prepareTesting, setPrepareTesting] = useState(false);
  const [archiveTesting, setArchiveTesting] = useState(false);

  useEffect(() => {
    (async () => {
      const settings = await api.getRepoSettings(repo.path);
      setPrepareScript(settings.prepareScript ?? "");
      setOriginalPrepareScript(settings.prepareScript ?? "");
      setArchiveScript(settings.archiveScript ?? "");
      setOriginalArchiveScript(settings.archiveScript ?? "");
      setDisableLsp(settings.disableLsp ?? false);
      setOriginalDisableLsp(settings.disableLsp ?? false);
      setLoading(false);
    })();
  }, [repo.path]);

  const handleSave = async () => {
    setSaving(true);
    await api.saveRepoSettings(repo.path, {
      prepareScript,
      archiveScript,
      disableLsp,
    });
    setSaving(false);
    onDismiss();
  };

  const handleTestPrepare = async () => {
    setPrepareTesting(true);
    setPrepareTestResult(null);
    const result = await api.testPrepareScript(repo.path, prepareScript);
    setPrepareTestResult(result);
    setPrepareTesting(false);
  };

  const handleTestArchive = async () => {
    setArchiveTesting(true);
    setArchiveTestResult(null);
    const result = await api.testArchiveScript(repo.path, archiveScript);
    setArchiveTestResult(result);
    setArchiveTesting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
    if (e.key === "s" && e.metaKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const isDirty =
    prepareScript !== originalPrepareScript ||
    archiveScript !== originalArchiveScript ||
    disableLsp !== originalDisableLsp;

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
          width: 480,
          maxHeight: "85vh",
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
            Repository Settings
          </h2>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {repo.name}
          </p>
        </div>

        {loading ? (
          <div
            className="text-center text-sm py-4"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Loading...
          </div>
        ) : (
          <>
            <ScriptSection
              label="Prepare workspace script"
              description="Runs in the workspace directory after each new workspace is created."
              script={prepareScript}
              onScriptChange={(v) => {
                setPrepareScript(v);
                setPrepareTestResult(null);
              }}
              onTestRun={handleTestPrepare}
              testing={prepareTesting}
              testResult={prepareTestResult}
            />

            <hr style={{ borderColor: "var(--ctp-surface1)" }} />

            <ScriptSection
              label="Archive workspace script"
              description="Runs in the workspace directory before the workspace is archived."
              script={archiveScript}
              onScriptChange={(v) => {
                setArchiveScript(v);
                setArchiveTestResult(null);
              }}
              onTestRun={handleTestArchive}
              testing={archiveTesting}
              testResult={archiveTestResult}
            />

            <hr style={{ borderColor: "var(--ctp-surface1)" }} />

            {/* Disable LSP for this repo. Overrides the global setting; useful
                for repositories where servers index slowly or pull in too
                much memory. */}
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="flex flex-col gap-0.5">
                <label
                  className="text-[11px] font-semibold"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  Disable LSP for this repository
                </label>
                <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
                  No language servers will spawn for workspaces under this repository.
                </p>
              </div>
              <button
                onClick={() => setDisableLsp(!disableLsp)}
                className="relative flex-shrink-0 rounded-full transition-colors"
                style={{
                  width: 36,
                  height: 20,
                  backgroundColor: disableLsp ? "var(--ctp-green)" : "var(--ctp-surface1)",
                }}
              >
                <div
                  className="absolute top-0.5 rounded-full transition-transform"
                  style={{
                    width: 16,
                    height: 16,
                    backgroundColor: "var(--ctp-text)",
                    transform: disableLsp ? "translateX(18px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>
          </>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
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
