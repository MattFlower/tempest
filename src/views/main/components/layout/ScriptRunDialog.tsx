import { useState, useEffect, useRef } from "react";
import type { CustomScript } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { onScriptRun } from "../../state/rpc-client";
import { useOverlay } from "../../state/useOverlay";

interface Props {
  script: CustomScript;
  repoPath: string;
  workspacePath: string;
  workspaceName: string;
  onDismiss: () => void;
  /** When provided, the dialog collects parameters and hands them off via
   *  this callback instead of executing the script itself. The caller is
   *  then responsible for launching (e.g. in the Run pane). The dialog
   *  auto-dismisses after the callback fires. */
  onParamsSubmit?: (values: Record<string, string>) => void;
}

export function ScriptRunDialog({
  script,
  repoPath,
  workspacePath,
  workspaceName,
  onDismiss,
  onParamsSubmit,
}: Props) {
  useOverlay();

  const hasParams = (script.parameters?.length ?? 0) > 0;

  // Parameter values — keyed by parameter name
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const vals: Record<string, string> = {};
    for (const p of script.parameters ?? []) {
      vals[p.name] = "";
    }
    return vals;
  });

  // Execution state
  const [phase, setPhase] = useState<"params" | "running" | "done">(
    hasParams ? "params" : "running",
  );
  const [output, setOutput] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupRef.current?.();
    };
  }, []);

  // Auto-start if no params needed. In params-only mode (onParamsSubmit set),
  // the parent handles launching — we just hand back the (empty) values and
  // dismiss without ever entering the running phase.
  useEffect(() => {
    if (hasParams) return;
    if (onParamsSubmit) {
      onParamsSubmit({});
      onDismiss();
    } else {
      startRun({});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = async (values: Record<string, string>) => {
    setPhase("running");
    setOutput("");
    setExitCode(null);

    const { runId } = await api.runCustomScript({
      repoPath,
      workspacePath,
      workspaceName,
      script: script.script || undefined,
      scriptPath: script.scriptPath || undefined,
      paramValues: values,
    });

    const unsubscribe = onScriptRun(
      runId,
      (data) => setOutput((prev) => prev + data),
      (code) => {
        setExitCode(code);
        setPhase("done");
      },
    );

    if (!isMountedRef.current) {
      // Dialog was dismissed while we awaited runCustomScript — clean up
      // immediately instead of leaking the subscription. cleanupRef will
      // not be read again since the unmount effect has already run.
      unsubscribe();
      return;
    }

    cleanupRef.current = unsubscribe;
  };

  const handleSubmitParams = () => {
    if (onParamsSubmit) {
      onParamsSubmit(paramValues);
      onDismiss();
      return;
    }
    startRun(paramValues);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
    if (e.key === "Enter" && phase === "params") {
      e.preventDefault();
      handleSubmitParams();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onDismiss}
    >
      <div
        className="flex flex-col gap-4 rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 520,
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <h2
          className="text-base font-bold text-center"
          style={{ color: "var(--ctp-text)" }}
        >
          {script.name}
        </h2>

        {/* Parameter input phase */}
        {phase === "params" && (
          <>
            <div className="flex flex-col gap-3">
              {(script.parameters ?? []).map((param) => (
                <div key={param.name} className="flex flex-col gap-1">
                  <label
                    className="text-[11px] font-semibold"
                    style={{ color: "var(--ctp-subtext0)" }}
                  >
                    {param.displayName || param.name}
                  </label>
                  <input
                    type="text"
                    value={paramValues[param.name] ?? ""}
                    onChange={(e) =>
                      setParamValues((prev) => ({
                        ...prev,
                        [param.name]: e.target.value,
                      }))
                    }
                    autoFocus={param === script.parameters![0]}
                    className="px-3 py-2 rounded text-sm outline-none"
                    style={{
                      backgroundColor: "var(--ctp-surface0)",
                      color: "var(--ctp-text)",
                      border: "1px solid var(--ctp-surface1)",
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 rounded text-sm transition-colors"
                style={{ color: "var(--ctp-overlay1)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitParams}
                className="px-3 py-1.5 rounded text-sm font-semibold"
                style={{
                  backgroundColor: "var(--ctp-blue)",
                  color: "var(--ctp-base)",
                }}
              >
                Run
              </button>
            </div>
          </>
        )}

        {/* Running / done — show output */}
        {(phase === "running" || phase === "done") && (
          <>
            {/* Status */}
            <div className="flex items-center gap-2">
              {phase === "running" && (
                <span
                  className="text-xs font-semibold"
                  style={{ color: "var(--ctp-yellow)" }}
                >
                  Running...
                </span>
              )}
              {phase === "done" && exitCode !== null && (
                <span
                  className="text-xs font-semibold"
                  style={{
                    color:
                      exitCode === 0
                        ? "var(--ctp-green)"
                        : "var(--ctp-red)",
                  }}
                >
                  {exitCode === 0
                    ? "Completed successfully"
                    : `Failed (exit ${exitCode})`}
                </span>
              )}
            </div>

            {/* Output */}
            <pre
              ref={outputRef}
              className="px-3 py-2 rounded text-[11px] font-mono overflow-auto whitespace-pre-wrap"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-subtext0)",
                border: "1px solid var(--ctp-surface1)",
                minHeight: 80,
                maxHeight: 400,
              }}
            >
              {output || (phase === "running" ? "" : "(no output)")}
            </pre>

            {/* Close button */}
            <div className="flex justify-end mt-1">
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 rounded text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: "var(--ctp-surface1)",
                  color: "var(--ctp-text)",
                }}
              >
                {phase === "running" ? "Close" : "Done"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
