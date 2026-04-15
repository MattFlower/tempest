// ============================================================
// BookmarkManager — Per-repo bookmark CRUD with JSON persistence.
// Storage: ~/.config/tempest/bookmarks/{sha256(repoPath)}.json
// ============================================================

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Bookmark } from "../../shared/ipc-types";
import { normalizeURL } from "../../shared/url-utils";
import { BOOKMARKS_DIR } from "../config/paths";

interface RepoBookmarks {
  version: number;
  bookmarks: Bookmark[];
}

function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export class BookmarkManager {
  private filePath: string;
  private bookmarks: Bookmark[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(repoPath: string) {
    const hash = sha256Hex(repoPath);
    this.filePath = join(BOOKMARKS_DIR, `${hash}.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const file = Bun.file(this.filePath);
          if (await file.exists()) {
            const data: RepoBookmarks = await file.json();
            const bookmarks = data.bookmarks ?? [];
            // Sort by position, filling in missing positions
            this.bookmarks = bookmarks.sort(
              (a, b) => (a.position ?? 0) - (b.position ?? 0),
            );
          }
        } catch {
          this.bookmarks = [];
        } finally {
          this.loaded = true;
          this.loadPromise = null;
        }
      })();
    }

    await this.loadPromise;
  }

  private async save(): Promise<void> {
    try {
      await mkdir(BOOKMARKS_DIR, { recursive: true });
      const data: RepoBookmarks = { version: 1, bookmarks: this.bookmarks };
      await Bun.write(this.filePath, JSON.stringify(data, null, 2));
    } catch {
      // Bookmarks are non-critical — silently fail
    }
  }

  private async updateIndex(hash: string, repoPath: string): Promise<void> {
    try {
      const indexPath = join(BOOKMARKS_DIR, "index.json");
      let index: Record<string, string> = {};
      const indexFile = Bun.file(indexPath);
      if (await indexFile.exists()) {
        index = await indexFile.json();
      }
      index[hash] = repoPath;
      await Bun.write(indexPath, JSON.stringify(index, null, 2));
    } catch {
      // Non-critical
    }
  }

  async getAll(): Promise<Bookmark[]> {
    await this.ensureLoaded();
    return this.bookmarks;
  }

  async add(url: string, label: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = normalizeURL(url);
    if (this.bookmarks.some((b) => normalizeURL(b.url) === normalized)) return;
    const maxPos = this.bookmarks.reduce(
      (max, b) => Math.max(max, b.position ?? 0),
      -1,
    );
    this.bookmarks.push({
      id: crypto.randomUUID(),
      url: normalized,
      label,
      createdAt: new Date().toISOString(),
      position: maxPos + 1,
    });
    await this.save();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    await this.save();
  }

  async update(id: string, label: string, url?: string): Promise<void> {
    await this.ensureLoaded();
    const bookmark = this.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;

    bookmark.label = label;

    const normalizedUrl = url ? normalizeURL(url) : undefined;
    const wouldCollide =
      normalizedUrl != null
      && this.bookmarks.some(
        (b) => b.id !== id && normalizeURL(b.url) === normalizedUrl,
      );
    if (normalizedUrl && !wouldCollide) {
      bookmark.url = normalizedUrl;
    }

    await this.save();
  }

  async contains(url: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = normalizeURL(url);
    return this.bookmarks.some((b) => normalizeURL(b.url) === normalized);
  }

  async findByUrl(url: string): Promise<Bookmark | undefined> {
    await this.ensureLoaded();
    const normalized = normalizeURL(url);
    return this.bookmarks.find((b) => normalizeURL(b.url) === normalized);
  }
}
