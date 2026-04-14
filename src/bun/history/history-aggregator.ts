// ============================================================
// HistoryAggregator — fans history queries out to multiple
// SessionHistoryProviders (Claude Code, Pi, …) and routes
// message loads back to whichever provider owns the file.
//
// Used by both the Chat History viewer RPC handlers and, in
// the future, the VCS AI Context panel.
// ============================================================

import type {
  HistoryProviderId,
  SessionHistoryProvider,
} from "./session-history-provider";
import type { SessionMessage } from "../../shared/ipc-types";

export class HistoryAggregator {
  private readonly providers = new Map<
    HistoryProviderId,
    SessionHistoryProvider
  >();

  register(provider: SessionHistoryProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  provider(id: HistoryProviderId): SessionHistoryProvider {
    const p = this.providers.get(id);
    if (!p) {
      throw new Error(`No history provider registered for '${id}'`);
    }
    return p;
  }

  allProviders(): SessionHistoryProvider[] {
    return Array.from(this.providers.values());
  }

  /** Route a message load by inspecting which provider owns the file. */
  async getMessages(sessionFilePath: string): Promise<SessionMessage[]> {
    for (const p of this.providers.values()) {
      if (p.ownsSessionFile(sessionFilePath)) {
        return p.getMessages(sessionFilePath);
      }
    }
    // Fallback: try Claude (backward compat — paths under ~/.claude)
    const claude = this.providers.get("claude");
    if (claude) return claude.getMessages(sessionFilePath);
    return [];
  }

  async initializeAll(): Promise<void> {
    for (const p of this.providers.values()) {
      try {
        await p.initialize();
      } catch (err) {
        console.error(
          `[HistoryAggregator] ${p.providerId} init failed:`,
          err,
        );
      }
    }
  }

  startRefreshTimers(): void {
    for (const p of this.providers.values()) p.startRefreshTimer();
  }

  stopRefreshTimers(): void {
    for (const p of this.providers.values()) p.stopRefreshTimer();
  }
}
