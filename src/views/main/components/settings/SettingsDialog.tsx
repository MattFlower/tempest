// ============================================================
// SettingsDialog — global application settings with tabs.
// Tabs: General (editor), Remote (HTTP server control).
// ============================================================

import { useState, useEffect, useRef, useMemo } from "react";
import QRCode from "qrcode";
import type { AppConfig, NetworkInterface } from "../../../../shared/ipc-types";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { useOverlay } from "../../state/useOverlay";

type Tab = "general" | "remote" | "tools";

export function SettingsDialog() {
  useOverlay();
  const toggleSettingsDialog = useStore((s) => s.toggleSettingsDialog);
  const initialTab = useStore((s) => s.settingsDialogInitialTab);
  const setHttpServerStatus = useStore((s) => s.setHttpServerStatus);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // General tab state
  const [editor, setEditor] = useState<"nvim" | "monaco">("nvim");
  const [vimMode, setVimMode] = useState(false);

  // MCP Tools tab state
  const [showWebpage, setShowWebpage] = useState(true);

  // Remote tab state
  const [httpEnabled, setHttpEnabled] = useState(false);
  const [httpPort, setHttpPort] = useState(7778);
  const [httpHostname, setHttpHostname] = useState("127.0.0.1");
  const [httpToken, setHttpToken] = useState("");
  const [httpPlanMode, setHttpPlanMode] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterface[]>([]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then((cfg: AppConfig) => {
      setConfig(cfg);
      setEditor(cfg.editor === "monaco" ? "monaco" : "nvim");
      setVimMode(cfg.monacoVimMode ?? false);
      setHttpPlanMode(cfg.httpDefaultPlanMode ?? false);
      setShowWebpage(cfg.mcpTools?.showWebpage !== false);
      if (cfg.httpServer) {
        setHttpEnabled(cfg.httpServer.enabled);
        setHttpPort(cfg.httpServer.port);
        setHttpHostname(cfg.httpServer.hostname || "127.0.0.1");
        setHttpToken(cfg.httpServer.token || "");
      }
    });
    api.getHttpServerStatus().then((status: any) => {
      setServerRunning(status.running);
      if (status.running) {
        if (status.port) setHttpPort(status.port);
        if (status.hostname) setHttpHostname(status.hostname);
        if (status.token) setHttpToken(status.token);
      }
      if (status.error) setServerError(status.error);
    });
    api.getNetworkInterfaces().then((ifaces: NetworkInterface[]) => {
      setNetworkInterfaces(ifaces);
    });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);

    const updated: AppConfig = {
      ...config,
      editor,
      monacoVimMode: vimMode,
      httpDefaultPlanMode: httpPlanMode,
      mcpTools: { showWebpage },
      httpServer: {
        enabled: httpEnabled,
        port: httpPort,
        hostname: httpHostname,
        token: httpToken,
      },
    };

    await api.saveConfig(updated);

    // Start or stop the HTTP server based on the toggle
    if (httpEnabled && !serverRunning) {
      const result = await api.startHttpServer({
        enabled: true,
        port: httpPort,
        hostname: httpHostname,
        token: httpToken,
      });
      setHttpToken(result.token);
      if (result.error) {
        setServerError(result.error);
        setServerRunning(false);
        setHttpServerStatus(false, result.error);
        setSaving(false);
        return;
      }
      setServerError(null);
      setServerRunning(true);
      setHttpServerStatus(true);
    } else if (httpEnabled && serverRunning) {
      // Restart with new settings
      await api.stopHttpServer();
      const result = await api.startHttpServer({
        enabled: true,
        port: httpPort,
        hostname: httpHostname,
        token: httpToken,
      });
      setHttpToken(result.token);
      if (result.error) {
        setServerError(result.error);
        setServerRunning(false);
        setHttpServerStatus(false, result.error);
        setSaving(false);
        return;
      }
      setServerError(null);
      setServerRunning(true);
      setHttpServerStatus(true);
    } else if (!httpEnabled && serverRunning) {
      await api.stopHttpServer();
      setServerRunning(false);
      setServerError(null);
      setHttpServerStatus(false);
    }

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
    ? (config.editor ?? "nvim") !== editor ||
      (config.monacoVimMode ?? false) !== vimMode ||
      (config.httpDefaultPlanMode ?? false) !== httpPlanMode ||
      (config.mcpTools?.showWebpage !== false) !== showWebpage ||
      (config.httpServer?.enabled ?? false) !== httpEnabled ||
      (config.httpServer?.port ?? 7778) !== httpPort ||
      (config.httpServer?.hostname ?? "127.0.0.1") !== httpHostname ||
      (config.httpServer?.token ?? "") !== httpToken
    : false;

  const handleGenerateToken = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setHttpToken(token);
  };

  // Compute the display host for URL — if listening on 0.0.0.0, use the first real interface
  const displayHost = useMemo(() => {
    if (httpHostname === "0.0.0.0") {
      const firstIface = networkInterfaces.find((i) => i.family === "IPv4");
      return firstIface?.address ?? "localhost";
    }
    return httpHostname;
  }, [httpHostname, networkInterfaces]);

  const serverUrl = `http://${displayHost}:${httpPort}/?token=${httpToken}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={toggleSettingsDialog}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
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
        <div
          className="text-center py-4"
          style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
        >
          <h2
            className="text-base font-bold"
            style={{ color: "var(--ctp-text)" }}
          >
            Settings
          </h2>
        </div>

        {/* Tabs */}
        <div
          className="flex px-4 pt-2 gap-1"
          style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
        >
          <TabButton
            label="General"
            active={activeTab === "general"}
            onClick={() => setActiveTab("general")}
          />
          <TabButton
            label="Remote"
            active={activeTab === "remote"}
            onClick={() => setActiveTab("remote")}
          />
          <TabButton
            label="MCP Tools"
            active={activeTab === "tools"}
            onClick={() => setActiveTab("tools")}
          />
        </div>

        {!config ? (
          <div
            className="text-center text-sm py-8"
            style={{ color: "var(--ctp-overlay1)" }}
          >
            Loading...
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5 overflow-y-auto">
            {activeTab === "general" && (
              <GeneralTab
                editor={editor}
                setEditor={setEditor}
                vimMode={vimMode}
                setVimMode={setVimMode}
              />
            )}
            {activeTab === "tools" && (
              <McpToolsTab
                showWebpage={showWebpage}
                setShowWebpage={setShowWebpage}
              />
            )}
            {activeTab === "remote" && (
              <RemoteTab
                enabled={httpEnabled}
                setEnabled={setHttpEnabled}
                port={httpPort}
                setPort={setHttpPort}
                hostname={httpHostname}
                setHostname={setHttpHostname}
                token={httpToken}
                onGenerateToken={handleGenerateToken}
                networkInterfaces={networkInterfaces}
                serverRunning={serverRunning}
                serverError={serverError}
                serverUrl={serverUrl}
                onCopyUrl={handleCopyUrl}
                copied={copied}
                planMode={httpPlanMode}
                setPlanMode={setHttpPlanMode}
              />
            )}
          </div>
        )}

        {/* Buttons */}
        <div
          className="flex justify-end gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--ctp-surface0)" }}
        >
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

// --- Tab Button ---

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium transition-colors"
      style={{
        color: active ? "var(--ctp-blue)" : "var(--ctp-overlay0)",
        borderBottom: active ? "2px solid var(--ctp-blue)" : "2px solid transparent",
        marginBottom: "-1px",
      }}
    >
      {label}
    </button>
  );
}

// --- General Tab ---

function GeneralTab({
  editor,
  setEditor,
  vimMode,
  setVimMode,
}: {
  editor: "nvim" | "monaco";
  setEditor: (v: "nvim" | "monaco") => void;
  vimMode: boolean;
  setVimMode: (v: boolean) => void;
}) {
  return (
    <>
      {/* Default Editor */}
      <div className="flex flex-col gap-2">
        <label
          className="text-[11px] font-semibold"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          Default File Editor
        </label>
        <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
          Choose which editor opens when you select a file.
        </p>
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
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="flex flex-col gap-0.5">
          <label
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Vim Keybindings
          </label>
          <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
            Enable vim keybindings in the Monaco editor.
          </p>
        </div>
        <ToggleSwitch value={vimMode} onChange={setVimMode} />
      </div>
    </>
  );
}

// --- Remote Tab ---

function RemoteTab({
  enabled,
  setEnabled,
  port,
  setPort,
  hostname,
  setHostname,
  token,
  onGenerateToken,
  networkInterfaces,
  serverRunning,
  serverError,
  serverUrl,
  onCopyUrl,
  copied,
  planMode,
  setPlanMode,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  port: number;
  setPort: (v: number) => void;
  hostname: string;
  setHostname: (v: string) => void;
  token: string;
  onGenerateToken: () => void;
  networkInterfaces: NetworkInterface[];
  serverRunning: boolean;
  serverError: string | null;
  serverUrl: string;
  onCopyUrl: () => void;
  copied: boolean;
  planMode: boolean;
  setPlanMode: (v: boolean) => void;
}) {
  // Build address options
  const addressOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [
      { label: "Localhost only (127.0.0.1)", value: "127.0.0.1" },
      { label: "All interfaces (0.0.0.0)", value: "0.0.0.0" },
    ];
    for (const iface of networkInterfaces) {
      opts.push({
        label: `${iface.name} (${iface.address})`,
        value: iface.address,
      });
    }
    return opts;
  }, [networkInterfaces]);

  return (
    <>
      <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
        Start an HTTP server to control Tempest remotely from a browser or phone.
      </p>

      {/* Enable toggle */}
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="flex flex-col gap-0.5">
          <label
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Enable Remote Server
          </label>
          <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
            {serverRunning ? (
              <span style={{ color: "var(--ctp-green)" }}>Running</span>
            ) : serverError ? (
              <span style={{ color: "var(--ctp-red)" }}>Error</span>
            ) : (
              "Not running"
            )}
          </p>
        </div>
        <ToggleSwitch value={enabled} onChange={setEnabled} />
      </div>

      {serverError && (
        <div
          className="rounded-md px-3 py-2 text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--ctp-red) 15%, transparent)",
            border: "1px solid var(--ctp-red)",
            color: "var(--ctp-red)",
          }}
        >
          {serverError}
        </div>
      )}

      {/* Default Plan Mode */}
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="flex flex-col gap-0.5">
          <label
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Default Plan Mode
          </label>
          <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
            Start new HTTP-created workspaces in plan mode by default.
          </p>
        </div>
        <ToggleSwitch value={planMode} onChange={setPlanMode} />
      </div>

      {/* Listen Address */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[11px] font-semibold"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          Listen Address
        </label>
        <select
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface1)",
            outline: "none",
          }}
        >
          {addressOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Port */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[11px] font-semibold"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          Port
        </label>
        <input
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 7778)}
          className="rounded-md px-3 py-1.5 text-sm w-28"
          style={{
            backgroundColor: "var(--ctp-surface0)",
            color: "var(--ctp-text)",
            border: "1px solid var(--ctp-surface1)",
            outline: "none",
          }}
        />
      </div>

      {/* Token */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[11px] font-semibold"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          Access Token
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={token}
            readOnly
            className="flex-1 rounded-md px-3 py-1.5 text-[11px] font-mono"
            style={{
              backgroundColor: "var(--ctp-surface0)",
              color: "var(--ctp-subtext0)",
              border: "1px solid var(--ctp-surface1)",
              outline: "none",
            }}
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={onGenerateToken}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap"
            style={{
              backgroundColor: "var(--ctp-surface1)",
              color: "var(--ctp-text)",
            }}
          >
            Generate
          </button>
        </div>
      </div>

      {/* URL + Copy */}
      {token && (
        <div className="flex flex-col gap-2">
          <label
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Server URL
          </label>
          <div className="flex gap-2 items-center">
            <div
              className="flex-1 rounded-md px-3 py-1.5 text-[11px] font-mono truncate"
              style={{
                backgroundColor: "var(--ctp-surface0)",
                color: "var(--ctp-subtext0)",
                border: "1px solid var(--ctp-surface1)",
              }}
              title={serverUrl}
            >
              {serverUrl}
            </div>
            <button
              onClick={onCopyUrl}
              className="px-3 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap"
              style={{
                backgroundColor: copied
                  ? "var(--ctp-green)"
                  : "var(--ctp-surface1)",
                color: copied ? "var(--ctp-base)" : "var(--ctp-text)",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-2 pt-2">
            <label
              className="text-[11px] font-semibold"
              style={{ color: "var(--ctp-subtext0)" }}
            >
              Scan to open on your phone
            </label>
            <QRCodeCanvas text={serverUrl} />
          </div>
        </div>
      )}
    </>
  );
}

// --- MCP Tools Tab ---

function McpToolsTab({
  showWebpage,
  setShowWebpage,
}: {
  showWebpage: boolean;
  setShowWebpage: (v: boolean) => void;
}) {
  return (
    <>
      <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
        Configure MCP tools available to Claude Code sessions.
        Changes take effect for new sessions.
      </p>

      <div className="flex items-center justify-between gap-3 py-1">
        <div className="flex flex-col gap-0.5">
          <label
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            Show Webpage
          </label>
          <p className="text-[11px]" style={{ color: "var(--ctp-overlay0)" }}>
            Allow Claude to display HTML content in a browser pane for visual discussions.
          </p>
        </div>
        <ToggleSwitch value={showWebpage} onChange={setShowWebpage} />
      </div>
    </>
  );
}

// --- Toggle Switch ---

function ToggleSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
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

// --- QR Code Component ---

function QRCodeCanvas({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    QRCode.toCanvas(canvas, text, {
      width: 200,
      margin: 2,
      color: {
        dark: "#1e1e2e",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    }).catch(() => {
      // If QR generation fails, show fallback
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#313244";
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = "#cdd6f4";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("QR generation failed", 100, 100);
      }
    });
  }, [text]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg"
      style={{ width: 200, height: 200 }}
    />
  );
}
