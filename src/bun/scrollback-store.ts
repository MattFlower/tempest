import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { TEMPEST_DIR } from "./config/paths";

const UUID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FILE_SUFFIX = ".json";

export interface ScrollbackRecord {
  scrollback: string;
  cwd?: string;
}

interface StoredRecord extends ScrollbackRecord {
  updatedAt: string;
}

/**
 * Per-terminal persistence for xterm scrollback buffers. Each terminal gets
 * its own `<terminalId>.json` file so that scrollback I/O doesn't rewrite
 * the session-state file on every autosave, and corruption in one file
 * cannot take down the pane tree or other terminals.
 */
export class ScrollbackStore {
  private readonly dir: string;

  constructor(baseDir?: string) {
    const root = baseDir ?? TEMPEST_DIR;
    this.dir = join(root, "scrollback");
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(this.dir, 0o700);
    } catch {
      // Best-effort on filesystems that don't support chmod (e.g. some mounts).
    }
  }

  private fileFor(id: string): string {
    if (!UUID_RE.test(id)) {
      throw new Error(`ScrollbackStore: invalid terminalId ${JSON.stringify(id)}`);
    }
    return join(this.dir, `${id}${FILE_SUFFIX}`);
  }

  async write(id: string, record: ScrollbackRecord): Promise<void> {
    const file = this.fileFor(id);
    this.ensureDir();

    const payload: StoredRecord = {
      scrollback: record.scrollback,
      cwd: record.cwd,
      updatedAt: new Date().toISOString(),
    };

    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await Bun.write(tmp, JSON.stringify(payload));
      try {
        chmodSync(tmp, 0o600);
      } catch {
        // best-effort
      }
      renameSync(tmp, file);
    } catch (err) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }
  }

  async read(id: string): Promise<ScrollbackRecord | null> {
    const file = this.fileFor(id);
    const handle = Bun.file(file);
    if (!(await handle.exists())) return null;
    try {
      const parsed = (await handle.json()) as StoredRecord;
      if (typeof parsed?.scrollback !== "string") return null;
      return { scrollback: parsed.scrollback, cwd: parsed.cwd };
    } catch (err) {
      console.log(`[ScrollbackStore] Failed to read ${id}: ${err}`);
      return null;
    }
  }

  async readMany(ids: Iterable<string>): Promise<Map<string, ScrollbackRecord>> {
    const list = [...ids];
    const results = await Promise.all(
      list.map(async (id): Promise<[string, ScrollbackRecord] | null> => {
        const rec = await this.read(id).catch(() => null);
        return rec ? [id, rec] : null;
      }),
    );
    const out = new Map<string, ScrollbackRecord>();
    for (const pair of results) {
      if (pair) out.set(pair[0], pair[1]);
    }
    return out;
  }

  async delete(id: string): Promise<void> {
    const file = this.fileFor(id);
    try {
      rmSync(file, { force: true });
    } catch {
      // ignore
    }
  }

  /**
   * Delete any scrollback file whose terminalId is not in `liveIds`.
   * Callers must only invoke this once the session state has been fully
   * loaded — calling it against a partial view will wipe valid data.
   * Returns the number of files deleted.
   */
  async gc(liveIds: Set<string>): Promise<{ deleted: number }> {
    if (!existsSync(this.dir)) return { deleted: 0 };

    let deleted = 0;
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(FILE_SUFFIX)) continue;
      const id = entry.slice(0, -FILE_SUFFIX.length);
      if (!UUID_RE.test(id)) continue;
      if (liveIds.has(id)) continue;

      try {
        rmSync(join(this.dir, entry), { force: true });
        deleted += 1;
      } catch {
        // ignore per-file failure; next gc will retry
      }
    }
    return { deleted };
  }

  /** List all terminalIds currently on disk (useful for tests/diagnostics). */
  listIds(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(FILE_SUFFIX))
      .map((f) => f.slice(0, -FILE_SUFFIX.length))
      .filter((id) => UUID_RE.test(id));
  }
}
