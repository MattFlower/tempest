// ============================================================
// Tempest-written manifest of installed LSP servers.
//
// Lives at ~/.config/tempest/lsp/manifest.json. Records which recipe is
// installed at which version, separately from `package.json` (which
// `bun install` controls) — so we can detect "version pin in source has
// moved past what's on disk" without scanning node_modules.
//
// Format is intentionally minimal: a version field for forward compat,
// and a flat `servers` map keyed by recipe.name. If the file is missing
// or unparseable we treat it as "nothing installed" — the next install
// rewrites it.
// ============================================================

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LSP_INSTALL_DIR } from "../../config/paths";
import { join } from "node:path";

export interface Manifest {
  version: 1;
  /** recipe.name → installed version string. */
  servers: Record<string, string>;
}

const MANIFEST_PATH = join(LSP_INSTALL_DIR, "manifest.json");

function emptyManifest(): Manifest {
  return { version: 1, servers: {} };
}

export class ManifestStore {
  async read(): Promise<Manifest> {
    const file = Bun.file(MANIFEST_PATH);
    if (!(await file.exists())) return emptyManifest();
    try {
      const data = (await file.json()) as unknown;
      if (
        data
        && typeof data === "object"
        && (data as { version?: unknown }).version === 1
        && (data as { servers?: unknown }).servers
        && typeof (data as { servers: unknown }).servers === "object"
      ) {
        // Filter to string values only — anything else is corruption.
        const raw = (data as { servers: Record<string, unknown> }).servers;
        const servers: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string") servers[k] = v;
        }
        return { version: 1, servers };
      }
    } catch {
      // fall through
    }
    return emptyManifest();
  }

  async write(manifest: Manifest): Promise<void> {
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }

  /** Convenience: read, set one entry, write. */
  async setServer(name: string, version: string): Promise<void> {
    const m = await this.read();
    m.servers[name] = version;
    await this.write(m);
  }
}
