// ============================================================
// LspServerProcess — one running LSP server process.
//
// Owns the spawned subprocess, the JSON-RPC framing on its stdio, and the
// LSP `initialize`/`initialized` handshake. Higher-level concerns (which
// servers are running for which workspace, restart policy, document
// replay) live in server-registry.ts.
//
// Each instance is tied to exactly one (workspacePath, languageId).
// Methods that send LSP messages return promises that resolve when the
// server replies; if the server crashes mid-flight, those promises reject.
// ============================================================

import type { FileSink, Subprocess } from "bun";
import {
  encodeMessage,
  isNotification,
  isResponse,
  MessageDecoder,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
} from "./jsonrpc";
import type { LspDiagnostic, LspServerStatus } from "../../shared/ipc-types";

export interface ServerSpawnConfig {
  /** Display name from the recipe (e.g. "typescript-language-server"). */
  name: string;
  command: string[];
  rootUri: string;             // file://...
  workspaceFolderName: string; // last segment of workspace path
  /** Monaco language id this server is responsible for in this process. */
  languageId: string;
  env?: Record<string, string>;
}

export interface ServerCallbacks {
  onStatusChange: (status: LspServerStatus, error?: string) => void;
  onDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
  /** Optional: server emitted `$/progress` or similar — phase 1 ignores most of these. */
  onLog?: (line: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export class LspServerProcess {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private decoder = new MessageDecoder();
  // Bun's stdin on a spawned subprocess is a FileSink with .write/.flush —
  // not a WritableStream. We write framed messages directly via FileSink.
  private writer: FileSink | null = null;

  private nextId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();

  // Capability cache from the server's initialize response. Used by the
  // bridge to answer "does this server support hover?" without poking
  // private state.
  private serverCaps: Record<string, unknown> | null = null;
  private status: LspServerStatus = "stopped";

  // Last ~200 stderr/log lines, kept for the popover's "view log" affordance.
  private logBuffer: string[] = [];
  private static LOG_LIMIT = 200;

  constructor(
    private readonly config: ServerSpawnConfig,
    private readonly callbacks: ServerCallbacks,
  ) {}

  getStatus(): LspServerStatus {
    return this.status;
  }

  getPid(): number | undefined {
    return this.proc?.pid;
  }

  getCapabilities(): Record<string, unknown> | null {
    return this.serverCaps;
  }

  getLogLines(): string[] {
    return [...this.logBuffer];
  }

  /**
   * Spawn the server process and run the LSP `initialize`/`initialized`
   * handshake. Resolves once `initialize` returns; from that point on, the
   * server is ready to accept document-sync notifications.
   *
   * Throws if the binary can't be spawned or `initialize` fails. The caller
   * (registry) catches and transitions the status to "error".
   */
  async start(): Promise<void> {
    this.setStatus("starting");

    try {
      this.proc = Bun.spawn(this.config.command, {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: { ...process.env, ...(this.config.env ?? {}) },
        // The server should not inherit the parent's controlling terminal —
        // it'll send escape sequences that confuse the framing decoder.
      });
    } catch (err: any) {
      const message = `Failed to spawn ${this.config.name}: ${err?.message ?? err}`;
      this.setStatus("error", message);
      throw new Error(message);
    }

    this.writer = this.proc.stdin;

    // Pump stdout: framed JSON-RPC.
    void this.pumpStdout();
    // Pump stderr: raw text, useful for diagnosing why a server failed.
    void this.pumpStderr();
    // Watch for early exit.
    void this.watchExit();

    const initParams = {
      processId: process.pid,
      clientInfo: { name: "tempest", version: "1.0" },
      locale: "en",
      rootUri: this.config.rootUri,
      capabilities: clientCapabilities(),
      workspaceFolders: [
        { uri: this.config.rootUri, name: this.config.workspaceFolderName },
      ],
      // typescript-language-server tunes some behaviour based on hostInfo
      // — without it, certain semantic operations (rename in particular)
      // can fail with "No Project" because tsserver doesn't fully open the
      // project. Other LSP servers ignore this field, so it's safe to
      // always pass.
      //
      // tsserver runs as two separate processes: a "syntax server" for
      // lightweight ops (hover, syntactic diagnostics, document symbols)
      // and a "semantic server" for ops that need full project info
      // (rename, references, find-implementations). With useSyntaxServer
      // set to "auto" (the default), typescript-language-server tries to
      // route requests to the lighter server when possible — but we've
      // observed it failing to bring up the semantic server for rename
      // and references, throwing "No Project" because the semantic
      // server doesn't have our file open. Forcing "never" routes every
      // request through the semantic server, which always has the
      // project loaded after initialize + didOpen. Costs a bit more RAM
      // and slows the first hover by a fraction; both negligible in
      // exchange for reliable rename / find-references.
      initializationOptions: {
        hostInfo: "tempest",
        // Type-acquisition spawns a separate downloader process that
        // races with project loading and has been seen to leave
        // tsserver in a state where the file is open but no project
        // is associated. Disabling it is safe because we already have
        // the project's own typescript installed.
        disableAutomaticTypingAcquisition: true,
        tsserver: {
          useSyntaxServer: "never",
          // No logVerbosity here — tsserver only writes its multi-MB
          // log file when verbose logging is on. The popover already
          // shows window/logMessage notifications which is enough
          // signal for routine debugging; flip this to "verbose"
          // ad-hoc when investigating a specific issue.
        },
        preferences: {
          providePrefixAndSuffixTextForRename: true,
          allowRenameOfImportPath: true,
          includeCompletionsForModuleExports: true,
          includeCompletionsWithInsertText: true,
          includeAutomaticOptionalChainCompletions: true,
          includeCompletionsWithSnippetText: true,
        },
      },
    };

    const initResult = (await this.request("initialize", initParams)) as {
      capabilities?: Record<string, unknown>;
    };
    this.serverCaps = initResult?.capabilities ?? {};
    this.notify("initialized", {});
    this.setStatus("ready");
  }

  /**
   * Graceful shutdown. Per LSP spec, send `shutdown` (request, expect null
   * response) then `exit` (notification, server quits). If the server hangs
   * we kill the process after a short timeout.
   */
  async stop(reason: "explicit" | "registry-disposal" = "explicit"): Promise<void> {
    if (!this.proc) {
      this.setStatus("stopped");
      return;
    }

    try {
      // Race shutdown against a 1.5s timeout — if the server doesn't reply,
      // it's probably already wedged and we should just kill it.
      await Promise.race([
        this.request("shutdown", null),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Server may have already crashed; that's fine.
    }
    try {
      this.notify("exit", null);
    } catch {
      // stdin may be closed already.
    }

    // Give the process a moment to exit cleanly, then SIGKILL if still alive.
    setTimeout(() => {
      try { this.proc?.kill(); } catch { /* already exited */ }
    }, 500);

    if (reason === "explicit") this.setStatus("stopped");
  }

  /**
   * Send a request and await the typed response. Rejects if the server
   * exits with the request still in flight.
   */
  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.writer) return Promise.reject(new Error("Server not started"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
      });
      this.writeMessage({ jsonrpc: "2.0", id, method, params }).catch((err) => {
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.writer) return;
    void this.writeMessage({ jsonrpc: "2.0", method, params });
  }

  // --- Internal ---

  private async writeMessage(msg: JsonRpcMessage): Promise<void> {
    if (!this.writer) throw new Error("Writer not initialized");
    this.writer.write(encodeMessage(msg));
    // Flush so the message hits the server immediately rather than sitting
    // in Bun's write buffer until the next tick.
    await this.writer.flush();
  }

  private async pumpStdout(): Promise<void> {
    if (!this.proc) return;
    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const msg of this.decoder.push(value)) {
          this.dispatch(msg);
        }
      }
    } catch (err) {
      // Stream errors usually mean the child died — exit watcher will fire.
      this.appendLog(`stdout read error: ${(err as Error).message}`);
    }
  }

  private async pumpStderr(): Promise<void> {
    if (!this.proc) return;
    const reader = (this.proc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          if (line.length > 0) this.appendLog(line);
        }
      }
      if (buffer.trim().length > 0) this.appendLog(buffer.trim());
    } catch {
      // process gone
    }
  }

  private async watchExit(): Promise<void> {
    if (!this.proc) return;
    const code = await this.proc.exited;
    // Reject any in-flight requests — the server can't answer them now.
    const error = new Error(`Server exited with code ${code}`);
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();

    if (this.status !== "stopped") {
      this.setStatus("error", `Server exited unexpectedly (code ${code})`);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if (isResponse(msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result ?? null);
      }
      return;
    }
    if (isNotification(msg)) {
      this.handleNotification(msg);
      return;
    }
    // Server-initiated requests (window/showMessageRequest, workspace/configuration,
    // etc.) — phase 1 doesn't answer them. Sending nothing leaves them
    // pending on the server, which is harmless for the small number of
    // server-initiated request types most servers send during init.
  }

  private handleNotification(msg: JsonRpcNotification): void {
    switch (msg.method) {
      case "textDocument/publishDiagnostics": {
        const params = msg.params as
          | { uri: string; diagnostics: LspDiagnostic[] }
          | undefined;
        if (params?.uri) {
          this.callbacks.onDiagnostics(params.uri, params.diagnostics ?? []);
        }
        return;
      }
      case "window/logMessage":
      case "window/showMessage": {
        const params = msg.params as { message?: string } | undefined;
        if (params?.message) this.appendLog(`[${msg.method}] ${params.message}`);
        return;
      }
      // Other notifications (telemetry/event, $/progress, etc.) are ignored
      // in phase 1. We can wire $/progress later for the "indexing" status.
    }
  }

  private setStatus(status: LspServerStatus, error?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange(status, error);
  }

  private appendLog(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > LspServerProcess.LOG_LIMIT) {
      this.logBuffer.splice(0, this.logBuffer.length - LspServerProcess.LOG_LIMIT);
    }
    this.callbacks.onLog?.(line);
  }
}

/**
 * Client capabilities sent in `initialize`.
 *
 * Beyond declaring what features we consume, advertising the right
 * capabilities affects the SHAPE of server responses:
 *   - `documentSymbol.hierarchicalDocumentSymbolSupport: true` makes
 *     servers return the modern `DocumentSymbol[]` tree instead of the
 *     legacy flat `SymbolInformation[]` (which our normalizer drops).
 *   - `rename.prepareSupport: true` enables servers (notably tsserver)
 *     to validate the rename target before responding.
 *   - `completion.completionItem.snippetSupport: true` lets servers
 *     return `$1` / `$2` placeholders we'll translate to Monaco snippets.
 *
 * We don't advertise capabilities for features we haven't built (code
 * actions, signature help, semantic tokens, etc.) — that prevents
 * servers from sending data we'd just discard.
 */
function clientCapabilities(): Record<string, unknown> {
  return {
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        willSave: false,
        willSaveWaitUntil: false,
        didSave: false,
      },
      hover: {
        dynamicRegistration: false,
        contentFormat: ["markdown", "plaintext"],
      },
      definition: {
        dynamicRegistration: false,
        linkSupport: false,
      },
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: false,
      },
      completion: {
        dynamicRegistration: false,
        contextSupport: true,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: false,
          documentationFormat: ["markdown", "plaintext"],
          deprecatedSupport: true,
          insertReplaceSupport: false,
          resolveSupport: { properties: ["documentation", "detail"] },
          insertTextModeSupport: { valueSet: [1] },
        },
      },
      references: {
        dynamicRegistration: false,
      },
      documentSymbol: {
        dynamicRegistration: false,
        // The big one: opt into the hierarchical DocumentSymbol shape so
        // tsserver / pyright / etc. don't fall back to the flat
        // SymbolInformation result, which has a `location` field instead
        // of `range` + `selectionRange` and gets rejected by our
        // normalizer.
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: {
          valueSet: [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
            14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
          ],
        },
      },
      rename: {
        dynamicRegistration: false,
        prepareSupport: true,
        // PrepareSupportDefaultBehavior: Identifier = 1.
        // Tells the server: "if you don't have a custom prepareRename
        // implementation, fall back to using the identifier under the
        // cursor as the rename range."
        prepareSupportDefaultBehavior: 1,
        honorsChangeAnnotations: false,
      },
    },
    workspace: {
      workspaceFolders: true,
      configuration: false,
      // Some servers gate semantic operations on workspace edit support
      // — without this, tsserver's rename can refuse to compute edits.
      workspaceEdit: {
        documentChanges: true,
        resourceOperations: ["create", "rename", "delete"],
        failureHandling: "abort",
      },
    },
  };
}
