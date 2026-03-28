// ============================================================
// BookmarkManager — Per-repo bookmark CRUD with JSON persistence.
// Port of Tempest/Browser/BookmarkManager.swift.
// Storage: ~/.config/Tempest/bookmarks/{sha256(repoPath)}.json
// ============================================================

import { join } from "path";
import { homedir } from "os";
import { mkdir } from "node:fs/promises";
import type { Bookmark } from "../../shared/ipc-types";
import { normalizeURL } from "../../shared/url-utils";

interface RepoBookmarks {
  version: number;
  bookmarks: Bookmark[];
}

const BOOKMARKS_DIR = join(homedir(), ".config", "Tempest", "bookmarks");

function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export class BookmarkManager {
  private filePath: string;
  private bookmarks: Bookmark[] = [];
  private loaded = false;

  constructor(repoPath: string) {
    const hash = sha256Hex(repoPath);
    this.filePath = join(BOOKMARKS_DIR, `${hash}.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const file = Bun.file(this.filePath);
      if (await file.exists()) {
        const data: RepoBookmarks = await file.json();
        this.bookmarks = data.bookmarks ?? [];
      }
    } catch {
      this.bookmarks = [];
    }
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

  async getAll(): Promise<Bookmark[]> {
    await this.ensureLoaded();
    return this.bookmarks;
  }

  async add(url: string, label: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = normalizeURL(url);
    if (this.bookmarks.some((b) => normalizeURL(b.url) === normalized)) return;
    this.bookmarks.push({
      id: crypto.randomUUID(),
      url: normalized,
      label,
    });
    await this.save();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
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
