// ============================================================
// LspItem — footer status item for LSP servers.
//
// Aggregate display:
//   Idle    — no servers running
//   Active  — N servers, all ready
//   Working — at least one starting / indexing / installing
//   Error   — at least one in `error` status
//
// Click → popover. Memory polling is gated on the popover's open state:
// we call lspMemoryWatchStart on open and lspMemoryWatchStop on close.
// Closing the popover stops Bun-side `ps` polling, so there's zero idle
// overhead when nobody is looking.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useLspStore } from "./lsp-store";
import { useStore } from "../../../state/store";
import { api } from "../../../state/rpc-client";
import type { LspServerState } from "../../../../../shared/ipc-types";

export function LspItem() {
  const servers = useLspStore((s) => s.servers);
  const lspDisabled = useStore((s) => s.config?.lspDisabled ?? false);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Hydrate on mount — pull current server snapshot. Subsequent updates
  // arrive via the lspServerStateChanged push channel and the store updates
  // automatically. Without this hydration the footer would be empty after
  // a webview reload while servers from a prior session are still running.
  useEffect(() => {
    api.lspListServers().then((res: any) => {
      const apply = useLspStore.getState().applyServerState;
      for (const state of res.servers ?? []) apply(state);
    });
  }, []);

  const summary = useMemo(() => summarizeServers(Object.values(servers)), [servers]);

  // The aggregate label and color depend on `summary.kind`. We never show
  // memory in the always-visible label — only in the popover.
  const { label, color, dot } = renderSummary(summary, lspDisabled);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setPopoverOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors"
        style={{
          color,
          backgroundColor: popoverOpen
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.03)",
        }}
        title={summary.kind === "off" ? "LSP is disabled in settings" : "Language servers"}
      >
        {dot && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: dot }}
          />
        )}
        <span>{label}</span>
      </button>
      {popoverOpen && (
        <LspPopover
          anchorRef={buttonRef}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}

interface Summary {
  kind: "off" | "idle" | "active" | "working" | "error";
  total: number;
  errorCount: number;
  workingNote?: string;
}

function summarizeServers(list: LspServerState[]): Summary {
  if (list.length === 0) return { kind: "idle", total: 0, errorCount: 0 };
  let errorCount = 0;
  let workingCount = 0;
  let workingNote: string | undefined;
  for (const s of list) {
    if (s.status === "error") errorCount += 1;
    else if (s.status === "starting" || s.status === "indexing") {
      workingCount += 1;
      if (!workingNote) {
        workingNote = s.status === "starting" ? `starting ${s.serverName}…` : `${s.serverName} indexing…`;
      }
    }
  }
  if (errorCount > 0) return { kind: "error", total: list.length, errorCount };
  if (workingCount > 0) return { kind: "working", total: list.length, errorCount: 0, workingNote };
  return { kind: "active", total: list.length, errorCount: 0 };
}

function renderSummary(s: Summary, disabled: boolean): { label: string; color: string; dot?: string } {
  if (disabled) return { label: "LSP · off", color: "rgba(255,255,255,0.35)" };
  switch (s.kind) {
    case "off":
      return { label: "LSP · off", color: "rgba(255,255,255,0.35)" };
    case "idle":
      return { label: "LSP", color: "rgba(255,255,255,0.35)" };
    case "active":
      return {
        label: `LSP · ${s.total} server${s.total === 1 ? "" : "s"}`,
        color: "rgba(255,255,255,0.6)",
        dot: "var(--ctp-green)",
      };
    case "working":
      return {
        label: `LSP · ${s.workingNote ?? "working…"}`,
        color: "var(--ctp-yellow)",
        dot: "var(--ctp-yellow)",
      };
    case "error":
      return {
        label: `LSP · ${s.errorCount} failed`,
        color: "var(--ctp-red)",
        dot: "var(--ctp-red)",
      };
  }
}

// --- Popover ---

function LspPopover({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const servers = useLspStore((s) => s.servers);
  const memoryByServer = useLspStore((s) => s.memoryByServer);
  const clearMemory = useLspStore((s) => s.clearMemory);

  // Position the popover above the button, anchored to its left edge.
  const [position, setPosition] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });

  useEffect(() => {
    const button = anchorRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
    });
  }, [anchorRef]);

  // Start memory polling on open, stop on close. The Bun side only keeps a
  // sampler running while at least one consumer is subscribed — closing the
  // popover means zero polling overhead.
  useEffect(() => {
    api.lspMemoryWatchStart().then((res: any) => {
      useLspStore.getState().applyMemorySamples(res.samples ?? []);
    });
    return () => {
      void api.lspMemoryWatchStop();
      clearMemory();
    };
  }, [clearMemory]);

  // Click outside to dismiss. Clicks on the anchor button are handled by
  // the parent (it toggles the popover state).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const button = anchorRef.current;
      if (button && (button === target || button.contains(target))) return;
      const popover = document.getElementById("lsp-popover");
      if (popover && popover.contains(target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [anchorRef, onClose]);

  // Group servers by workspacePath
  const grouped = useMemo(() => {
    const map = new Map<string, LspServerState[]>();
    for (const s of Object.values(servers)) {
      const list = map.get(s.workspacePath) ?? [];
      list.push(s);
      map.set(s.workspacePath, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [servers]);

  return (
    <div
      id="lsp-popover"
      className="fixed z-50 rounded-lg shadow-2xl"
      style={{
        left: position.left,
        bottom: position.bottom,
        backgroundColor: "var(--ctp-base)",
        border: "1px solid var(--ctp-surface1)",
        width: 460,
        maxHeight: 360,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="px-3 py-2 text-[11px] font-semibold flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--ctp-surface0)",
          color: "var(--ctp-subtext0)",
        }}
      >
        <span>Language Servers</span>
        <span style={{ color: "var(--ctp-overlay0)" }}>
          {Object.keys(servers).length} running
        </span>
      </div>
      {Object.keys(servers).length === 0 ? (
        <div className="px-3 py-4 text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
          No language servers running. They start automatically when you open
          a file in a supported language.
        </div>
      ) : (
        <div className="overflow-y-auto" style={{ flex: 1 }}>
          {grouped.map(([wsPath, group]) => (
            <div key={wsPath}>
              <div
                className="px-3 py-1 text-[10px] font-mono truncate"
                style={{
                  color: "var(--ctp-overlay0)",
                  backgroundColor: "var(--ctp-mantle)",
                }}
                title={wsPath}
              >
                {wsPath}
              </div>
              {group.map((s) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  rssBytes={memoryByServer[s.id]}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServerRow({
  server,
  rssBytes,
}: {
  server: LspServerState;
  rssBytes: number | null | undefined;
}) {
  const [busy, setBusy] = useState<"restart" | "stop" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);

  const handleRestart = async () => {
    setBusy("restart");
    await api.lspRestartServer(server.id);
    setBusy(null);
  };
  const handleStop = async () => {
    setBusy("stop");
    await api.lspStopServer(server.id);
    setBusy(null);
  };
  const handleViewLog = async () => {
    if (!logOpen) {
      const res: any = await api.lspGetServerLog(server.id);
      setLogLines(res.lines ?? []);
    }
    setLogOpen((v) => !v);
  };

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 text-[11px]"
      style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: statusColor(server.status), width: 60 }}>
          {server.status}
        </span>
        <span className="flex-1 truncate" style={{ color: "var(--ctp-text)" }}>
          {server.serverName}
        </span>
        <span className="font-mono" style={{ color: "var(--ctp-overlay0)", width: 64, textAlign: "right" }}>
          {formatBytes(rssBytes ?? null)}
        </span>
        <button
          onClick={handleRestart}
          disabled={busy !== null}
          className="px-1.5 py-0.5 rounded text-[10px]"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-subtext0)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
          title="Restart"
        >
          ↻
        </button>
        <button
          onClick={handleStop}
          disabled={busy !== null}
          className="px-1.5 py-0.5 rounded text-[10px]"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-red)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
          title="Stop"
        >
          ⏻
        </button>
        <button
          onClick={handleViewLog}
          className="px-1.5 py-0.5 rounded text-[10px]"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-subtext0)",
          }}
          title="View log"
        >
          log
        </button>
      </div>
      {server.lastError && (
        <div style={{ color: "var(--ctp-red)" }} className="text-[10px]">
          {server.lastError}
        </div>
      )}
      {logOpen && (
        <pre
          className="rounded p-2 text-[10px] font-mono overflow-auto"
          style={{
            backgroundColor: "var(--ctp-mantle)",
            color: "var(--ctp-subtext0)",
            border: "1px solid var(--ctp-surface0)",
            maxHeight: 140,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {logLines.length > 0 ? logLines.join("\n") : "(no log output)"}
        </pre>
      )}
    </div>
  );
}

function statusColor(status: LspServerState["status"]): string {
  switch (status) {
    case "ready": return "var(--ctp-green)";
    case "starting": return "var(--ctp-yellow)";
    case "indexing": return "var(--ctp-yellow)";
    case "error": return "var(--ctp-red)";
    case "stopped": return "var(--ctp-overlay0)";
    default: return "var(--ctp-overlay0)";
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
