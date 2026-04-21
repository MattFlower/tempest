// ============================================================
// Mermaid HTML Builder (Bun-side)
// Builds a self-contained HTML page that renders a single
// Mermaid diagram filling the viewport. Mermaid.js is inlined
// at build time via Bun text import (same pattern as
// markdown-html-builder.ts).
// ============================================================

// @ts-ignore — Bun text import
import mermaidSourceText from "mermaid/dist/mermaid.min.js" with { type: "text" };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildMermaidHTML(diagram: string, title: string): string {
  const escapedDiagram = escapeHtml(diagram);
  const escapedTitle = escapeHtml(title);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapedTitle}</title>
<style>
:root { color-scheme: light dark; }
@media (prefers-color-scheme: light) { :root { --bg: #f6f3ee; --text: #3d3a35; } }
@media (prefers-color-scheme: dark)  { :root { --bg: #28272c; --text: #d6d2c8; } }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; min-height: 100vh;
}
.mermaid {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  text-align: center;
}
.mermaid svg { max-width: 100%; height: auto; }
.error {
  color: #c94a4a; font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px; white-space: pre-wrap; padding: 16px;
  border: 1px solid #c94a4a; border-radius: 8px; background: rgba(201,74,74,0.08);
}
</style>
</head>
<body>
<div class="mermaid">${escapedDiagram}</div>
<script>${mermaidSourceText}</script>
<script>
(function() {
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
    });
    mermaid.run();
  } catch (err) {
    var el = document.querySelector('.mermaid');
    if (el) {
      el.className = 'error';
      el.textContent = 'Mermaid render failed: ' + (err && err.message ? err.message : String(err));
    }
  }
})();
</script>
</body>
</html>`;
}
