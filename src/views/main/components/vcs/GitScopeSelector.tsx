// ============================================================
// GitScopeSelector — tab-style scope selector for Git VCS view.
// Switches between Working Changes, Commit, and Since Trunk.
// ============================================================

import { DiffScope } from "../../../../shared/ipc-types";

interface GitScopeSelectorProps {
  scope: DiffScope;
  onScopeChange: (scope: DiffScope) => void;
}

const TABS: { scope: DiffScope; label: string }[] = [
  { scope: DiffScope.CurrentChange, label: "Working" },
  { scope: DiffScope.SingleCommit, label: "Commit" },
  { scope: DiffScope.SinceTrunk, label: "Since Trunk" },
];

export function GitScopeSelector({ scope, onScopeChange }: GitScopeSelectorProps) {
  return (
    <div
      className="flex items-center gap-0.5 px-2 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderBottom: "1px solid var(--ctp-surface0)",
      }}
    >
      <div
        className="flex rounded overflow-hidden"
        style={{ border: "1px solid var(--ctp-surface1)" }}
      >
        {TABS.map((tab) => {
          const isActive = scope === tab.scope;
          return (
            <button
              key={tab.scope}
              className="px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: isActive ? "var(--ctp-surface0)" : "transparent",
                color: isActive ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              }}
              onClick={() => onScopeChange(tab.scope)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
