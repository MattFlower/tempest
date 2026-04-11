// ============================================================
// URL utilities shared between Bun and Webview processes.
// ============================================================

/**
 * Resolve omnibox input to a navigable URL. If the input looks like a URL
 * or host, return it (adding https:// if needed). Otherwise, return a Google
 * search URL for the query.
 */
export function resolveOmniboxInput(raw: string): string {
  const input = raw.trim();
  if (!input) return input;

  // Explicit scheme — trust it.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (/^(about|file|data|javascript|chrome|view-source):/i.test(input)) return input;

  // Whitespace → definitely a search query.
  if (/\s/.test(input)) return googleSearchURL(input);

  // localhost[:port][/path]
  if (/^localhost(:\d+)?(\/.*)?$/i.test(input)) return "https://" + input;

  // IPv4[:port][/path]
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(input)) return "https://" + input;

  // Host-like: the part before the first slash/colon must look like a domain
  // (letters/digits/dots/hyphens ending in a letter-only TLD of 2+ chars).
  const hostPart = input.split(/[/?#:]/)[0] ?? "";
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(hostPart)) {
    return "https://" + input;
  }

  return googleSearchURL(input);
}

function googleSearchURL(query: string): string {
  return "https://www.google.com/search?q=" + encodeURIComponent(query);
}

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
