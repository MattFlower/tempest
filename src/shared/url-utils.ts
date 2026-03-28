// ============================================================
// URL utilities shared between Bun and Webview processes.
// ============================================================

/**
 * Normalize a URL for comparison/deduplication.
 * Lowercases scheme and host, strips trailing slash from path.
 */
export function normalizeURL(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw;
  }
}
