// ============================================================
// Markdown HTML Builder (Bun-side)
// Renders markdown to HTML using markdown-it + highlight.js,
// then wraps in a styled page. Mermaid is inlined from
// node_modules only when mermaid blocks are detected.
//
// All static assets are imported as text at build time so
// they get bundled into the app (no runtime filesystem reads).
// ============================================================

import markdownit from "markdown-it";
import hljs from "highlight.js";

// @ts-ignore — Bun text import
import hljsCssDark from "highlight.js/styles/github-dark.min.css" with { type: "text" };
// @ts-ignore — Bun text import
import hljsCssLight from "highlight.js/styles/github.min.css" with { type: "text" };
// @ts-ignore — Bun text import
import mermaidSourceText from "mermaid/dist/mermaid.min.js" with { type: "text" };

// Configure markdown-it with highlight.js
const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch {}
    }
    try {
      return hljs.highlightAuto(str).value;
    } catch {}
    return "";
  },
});

/**
 * Build a complete self-contained HTML page from markdown.
 * Markdown is rendered server-side; only mermaid (which needs DOM) runs client-side.
 */
export function buildMarkdownHTML(markdown: string): string {
  const renderedHTML = md.render(markdown);
  const hasMermaid = renderedHTML.includes('class="language-mermaid"');

  // Build mermaid script block only if needed
  let mermaidBlock = "";
  if (hasMermaid) {
    mermaidBlock = `
<script>${mermaidSourceText}</script>
<script>
(function() {
  mermaid.initialize({
    startOnLoad: false,
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
  });
  document.querySelectorAll('pre > code.language-mermaid').forEach(function(el) {
    var pre = el.parentElement;
    var div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = el.textContent;
    pre.replaceWith(div);
  });
  mermaid.run();
})();
</script>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
:root { color-scheme: light dark; }

@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff; --text: #1a1a1a; --text-secondary: #555;
    --code-bg: #f5f5f5; --code-border: #e0e0e0;
    --blockquote-border: #ddd; --blockquote-text: #666;
    --link: #0066cc; --table-border: #ddd; --table-stripe: #f9f9f9; --hr: #ddd;
  }
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e2e; --text: #cdd6f4; --text-secondary: #a6adc8;
    --code-bg: #181825; --code-border: #313244;
    --blockquote-border: #45475a; --blockquote-text: #a6adc8;
    --link: #89b4fa; --table-border: #45475a; --table-stripe: #1a1a2e; --hr: #45475a;
  }
}

@media (prefers-color-scheme: light) { ${hljsCssLight} }
@media (prefers-color-scheme: dark) { ${hljsCssDark} }

body {
  margin: 0; padding: 24px 32px;
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  font-size: 15px; line-height: 1.7; -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
h1 { font-size: 2em; border-bottom: 1px solid var(--hr); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--hr); padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; font-size: 0.9em;
  background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; border: 1px solid var(--code-border);
}
pre {
  background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: 8px; padding: 16px; overflow-x: auto;
}
pre code { background: none; border: none; padding: 0; font-size: 13px; line-height: 1.5; }
blockquote { margin: 1em 0; padding: 0.5em 1em; border-left: 4px solid var(--blockquote-border); color: var(--blockquote-text); }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid var(--table-border); padding: 8px 12px; text-align: left; }
tr:nth-child(even) { background: var(--table-stripe); }
hr { border: none; border-top: 1px solid var(--hr); margin: 2em 0; }
img { max-width: 100%; height: auto; border-radius: 4px; }
ul, ol { padding-left: 2em; }
li { margin-bottom: 0.3em; }
.task-list-item { list-style: none; margin-left: -1.5em; }
.task-list-item input { margin-right: 0.5em; }
.mermaid { text-align: center; margin: 1em 0; }
</style>
</head>
<body>
${renderedHTML}
${mermaidBlock}
</body>
</html>`;
}
