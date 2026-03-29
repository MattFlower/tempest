// ============================================================
// Typed RPC client for the webview process.
// Wraps Electrobun's RPC with sequence ordering for terminal output.
// ============================================================

import { Electroview } from "electrobun/view";
import type { BunMessages, WebviewMessages } from "../../../shared/rpc-schema";

// Sequence-ordered output buffer for terminal output.
// Electrobun's async encrypted WebSocket can deliver RPC messages
// out of order. We buffer and replay in sequence.
const nextExpectedSeq = new Map<string, number>();
const pendingOutputs = new Map<string, Map<number, string>>();

type TerminalOutputHandler = (id: string, data: string) => void;
let terminalOutputHandler: TerminalOutputHandler | null = null;

export function onTerminalOutput(handler: TerminalOutputHandler) {
  terminalOutputHandler = handler;
}

function processTerminalOutput(id: string, data: string, seq: number) {
  const expected = nextExpectedSeq.get(id) ?? 1;

  if (seq === expected) {
    terminalOutputHandler?.(id, data);
    nextExpectedSeq.set(id, seq + 1);

    const pending = pendingOutputs.get(id);
    if (pending) {
      let next = seq + 1;
      while (pending.has(next)) {
        terminalOutputHandler?.(id, pending.get(next)!);
        pending.delete(next);
        next++;
      }
      nextExpectedSeq.set(id, next);
    }
  } else if (seq > expected) {
    if (!pendingOutputs.has(id)) pendingOutputs.set(id, new Map());
    pendingOutputs.get(id)!.set(seq, data);
  }
}

// Message handlers for messages FROM Bun
type TerminalExitHandler = (id: string, exitCode: number) => void;
type HookEventHandler = (event: WebviewMessages["hookEvent"]) => void;

let terminalExitHandler: TerminalExitHandler | null = null;
let hookEventHandler: HookEventHandler | null = null;

export function onTerminalExit(handler: TerminalExitHandler) {
  terminalExitHandler = handler;
}

export function onHookEvent(handler: HookEventHandler) {
  hookEventHandler = handler;
}

// Initialize RPC and Electroview
const rpc = Electroview.defineRPC({
  handlers: {
    requests: {},
    messages: {
      terminalOutput: ({
        id,
        data,
        seq,
      }: WebviewMessages["terminalOutput"]) => {
        processTerminalOutput(id, data, seq);
      },
      terminalExit: ({ id, exitCode }: WebviewMessages["terminalExit"]) => {
        terminalExitHandler?.(id, exitCode);
      },
      hookEvent: (event: WebviewMessages["hookEvent"]) => {
        hookEventHandler?.(event);
      },
      workspaceActivityChanged: (msg: any) => {
        if (msg.activityState !== null && msg.activityState !== undefined) {
          import("./store").then(({ useStore }) => {
            useStore.getState().setWorkspaceActivity(msg.workspacePath, msg.activityState);
          });
        }
      },
      workspacesChanged: (msg: WebviewMessages["workspacesChanged"]) => {
        // Handled by store subscription — imported dynamically to avoid circular deps
        import("./store").then(({ useStore }) => {
          useStore.getState().setWorkspaces(msg.repoId, msg.workspaces);
        });
      },
      sidebarInfoUpdated: (msg: WebviewMessages["sidebarInfoUpdated"]) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().setSidebarInfo(msg.workspacePath, msg.info);
        });
      },
      configChanged: (config: WebviewMessages["configChanged"]) => {
        import("./store").then(({ useStore }) => {
          useStore.getState().setConfig(config);
        });
      },
      menuAction: (msg: WebviewMessages["menuAction"]) => {
        import("./store").then(({ useStore }) => {
          const store = useStore.getState();
          switch (msg.action) {
            case "toggle-sidebar":
              store.toggleSidebar();
              break;
            case "command-palette":
              store.toggleCommandPalette();
              break;
            // new-workspace and add-repo will be handled by Stream D
          }
        });
      },
    },
  },
});

const electroview = new Electroview({ rpc });

// Export typed RPC proxy for webview → bun calls
export const rpcRequest = rpc.request as any;
export const rpcSend = rpc.send as any;

// Convenience typed wrappers
export const api = {
  // Terminal
  createTerminal: (params: {
    id: string;
    command: string[];
    cwd: string;
    env?: Record<string, string>;
    cols: number;
    rows: number;
  }) => rpcRequest.createTerminal(params),

  resizeTerminal: (params: { id: string; cols: number; rows: number }) =>
    rpcRequest.resizeTerminal(params),

  killTerminal: (params: { id: string }) => rpcRequest.killTerminal(params),

  writeToTerminal: (id: string, data: string) =>
    rpcSend.writeToTerminal({ id, data }),

  // Session commands
  buildClaudeCommand: (params: {
    workspacePath: string;
    resume: boolean;
    sessionId?: string;
    withHooks: boolean;
  }) => rpcRequest.buildClaudeCommand(params),

  buildShellCommand: (params: { workspacePath: string }) =>
    rpcRequest.buildShellCommand(params),

  // Repos
  getRepos: () => rpcRequest.getRepos(),
  addRepo: (path: string) => rpcRequest.addRepo({ path }),
  removeRepo: (repoId: string) => rpcRequest.removeRepo({ repoId }),

  // Workspaces
  getWorkspaces: (repoId: string) => rpcRequest.getWorkspaces({ repoId }),
  createWorkspace: (params: {
    repoId: string;
    name: string;
    branch?: string;
  }) => rpcRequest.createWorkspace(params),
  archiveWorkspace: (workspaceId: string) =>
    rpcRequest.archiveWorkspace({ workspaceId }),

  // Sidebar
  getSidebarInfo: (workspacePath: string) =>
    rpcRequest.getSidebarInfo({ workspacePath }),

  // Config
  getConfig: () => rpcRequest.getConfig(),
  saveConfig: (config: any) => rpcRequest.saveConfig(config),

  // Bookmarks
  getBookmarks: (repoPath: string) => rpcRequest.getBookmarks({ repoPath }),
  addBookmark: (repoPath: string, url: string, label: string) =>
    rpcRequest.addBookmark({ repoPath, url, label }),
  removeBookmark: (repoPath: string, bookmarkId: string) =>
    rpcRequest.removeBookmark({ repoPath, bookmarkId }),

  // Session state
  loadSessionState: () => rpcRequest.loadSessionState(),
  savePaneState: (workspacePath: string, paneTree: any) =>
    rpcRequest.savePaneState({ workspacePath, paneTree }),

  // Files
  listFiles: (workspacePath: string) =>
    rpcRequest.listFiles({ workspacePath }),

  // Pane tree sync
  notifyPaneTreeChanged: (workspacePath: string, tree: any) =>
    rpcSend.paneTreeChanged({ workspacePath, tree }),
};
