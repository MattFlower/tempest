// ============================================================
// Per-server document store.
//
// Tracks every open (uri, languageId) attached to one LspServerProcess so
// the registry can replay didOpen on a server restart and the bridge can
// emit correctly-versioned didChange notifications.
//
// The `text` is held in memory because LSP doesn't expose a "what's the
// current state" query — if a server crashes mid-edit, the only authority
// is whatever the editor sent last. Without this cache, a restart would
// either lose the unsaved buffer or force the webview to re-read every
// open file from disk.
// ============================================================

export interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export class DocumentStore {
  private docs = new Map<string, OpenDocument>(); // key: uri

  open(uri: string, languageId: string, version: number, text: string): void {
    this.docs.set(uri, { uri, languageId, version, text });
  }

  /** Update version + text for a previously-opened doc. No-op if not open. */
  update(uri: string, version: number, text: string): boolean {
    const existing = this.docs.get(uri);
    if (!existing) return false;
    existing.version = version;
    existing.text = text;
    return true;
  }

  close(uri: string): void {
    this.docs.delete(uri);
  }

  get(uri: string): OpenDocument | undefined {
    return this.docs.get(uri);
  }

  /** Snapshot of all open docs — used to replay didOpen after a server restart. */
  all(): OpenDocument[] {
    return Array.from(this.docs.values());
  }

  size(): number {
    return this.docs.size;
  }

  clear(): void {
    this.docs.clear();
  }
}
