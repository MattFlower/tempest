import { useState, useEffect } from "react";
import { api } from "../../state/rpc-client";
import type { BinaryStatus } from "../../../../shared/ipc-types";

interface OnboardingDialogProps {
  defaultRoot: string;
  onComplete: () => void;
}

function BinaryCheckRow({
  name,
  found,
  checking,
  optional,
}: {
  name: string;
  found: boolean;
  checking: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 h-7">
      {checking ? (
        <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--ctp-overlay0)", borderTopColor: "transparent" }} />
      ) : found ? (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="var(--ctp-green)">
          <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 4.97a.75.75 0 00-1.06 0L7 8.69 5.28 6.97a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
        </svg>
      ) : optional ? (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="var(--ctp-yellow)">
          <path d="M8 0a8 8 0 110 16A8 8 0 018 0zM4.5 8a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="var(--ctp-red)">
          <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm2.78 4.97a.75.75 0 00-1.06 0L8 6.69 6.28 4.97a.75.75 0 00-1.06 1.06L6.94 7.75 5.22 9.47a.75.75 0 101.06 1.06L8 8.81l1.72 1.72a.75.75 0 101.06-1.06L9.06 7.75l1.72-1.72a.75.75 0 000-1.06z" />
        </svg>
      )}
      <span className="font-mono text-sm" style={{ color: "var(--ctp-text)" }}>{name}</span>
      <span className="flex-1" />
      {!checking && !found && (
        <span className="text-xs" style={{ color: optional ? "var(--ctp-overlay0)" : "var(--ctp-red)" }}>
          {optional ? `Optional -- ${name} features unavailable` : "Not found -- required"}
        </span>
      )}
    </div>
  );
}

export function OnboardingDialog({ defaultRoot, onComplete }: OnboardingDialogProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState(defaultRoot);
  const [binaries, setBinaries] = useState<BinaryStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.checkBinaries().then((result: BinaryStatus) => {
      setBinaries(result);
      setChecking(false);
    }).catch(() => {
      setBinaries({ git: false, jj: false, claude: false, gh: false });
      setChecking(false);
    });
  }, []);

  const canProceed = !checking && binaries?.git && binaries?.claude && workspaceRoot.trim().length > 0;

  const handleGetStarted = async () => {
    setSaving(true);
    try {
      await api.setWorkspaceRoot(workspaceRoot.trim());
      // Reload config into store
      const config = await api.getConfig();
      const { useStore } = await import("../../state/store");
      useStore.getState().setConfig(config);
      onComplete();
    } catch (err) {
      console.error("[onboarding] Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div
        className="flex flex-col gap-5 rounded-xl p-8 shadow-2xl"
        style={{
          backgroundColor: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface0)",
          width: 450,
        }}
      >
        {/* Icon */}
        <div className="flex justify-center">
          <svg className="w-12 h-12" viewBox="0 0 24 24" fill="var(--ctp-mauve)">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-xl font-bold" style={{ color: "var(--ctp-text)" }}>Welcome to Tempest</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ctp-overlay0)" }}>
            Parallel Claude Code sessions, each in their own workspace.
          </p>
        </div>

        {/* Divider */}
        <div className="h-px" style={{ backgroundColor: "var(--ctp-surface0)" }} />

        {/* Workspace Root */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--ctp-subtext0)" }}>
            Workspace Root
          </label>
          <input
            type="text"
            value={workspaceRoot}
            onChange={(e) => setWorkspaceRoot(e.target.value)}
            placeholder="/path/to/workspaces"
            className="px-3 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
            }}
          />
          <span className="text-xs" style={{ color: "var(--ctp-overlay0)" }}>
            Directory where Tempest creates workspace folders.
          </span>
        </div>

        {/* Binary checks */}
        <div className="flex flex-col gap-1">
          <BinaryCheckRow name="git" found={binaries?.git ?? false} checking={checking} />
          <BinaryCheckRow name="jj" found={binaries?.jj ?? false} checking={checking} optional />
          <BinaryCheckRow name="claude" found={binaries?.claude ?? false} checking={checking} />
          <BinaryCheckRow name="gh" found={binaries?.gh ?? false} checking={checking} optional />
        </div>

        {/* Divider */}
        <div className="h-px" style={{ backgroundColor: "var(--ctp-surface0)" }} />

        {/* Get Started */}
        <button
          onClick={handleGetStarted}
          disabled={!canProceed || saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
          style={{
            backgroundColor: canProceed ? "var(--ctp-mauve)" : "var(--ctp-surface1)",
            color: canProceed ? "var(--ctp-base)" : "var(--ctp-overlay0)",
            opacity: canProceed && !saving ? 1 : 0.5,
            cursor: canProceed && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving..." : "Get Started"}
        </button>
      </div>
    </div>
  );
}
