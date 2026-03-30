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
import { frontmatterPlugin } from "@mdit-vue/plugin-frontmatter";
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

md.use(frontmatterPlugin);

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
    --bg: #f6f3ee; --bg-surface: #ece8e1; --text: #3d3a35; --text-secondary: #6b665e;
    --code-bg: #e6e2da; --code-border: #d5d0c7;
    --blockquote-border: #c49a4a; --blockquote-bg: rgba(196,154,74,0.06); --blockquote-text: #5c5850;
    --link: #9a7430; --link-hover: #c49a4a;
    --table-border: #d5d0c7; --table-header-bg: #e6e2da; --table-stripe: #ece8e1;
    --hr-from: #c49a4a; --hr-to: #a08060;
    --accent-1: #9a7430; --accent-2: #c49a4a; --accent-3: #a08060;
    --heading-1: #2e2b27; --heading-2: #3d3a35; --heading-3: #5c5850;
    --bullet: #c49a4a;
    --shadow-code: rgba(0,0,0,0.05);
  }
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #28272c; --bg-surface: #201f24; --text: #d6d2c8; --text-secondary: #a09b90;
    --code-bg: #1e1d22; --code-border: #38363d;
    --blockquote-border: #d4a85a; --blockquote-bg: rgba(212,168,90,0.05); --blockquote-text: #a09b90;
    --link: #d4a85a; --link-hover: #e8c47a;
    --table-border: #38363d; --table-header-bg: #201f24; --table-stripe: rgba(56,54,61,0.3);
    --hr-from: #d4a85a; --hr-to: #a08868;
    --accent-1: #d4a85a; --accent-2: #e8c47a; --accent-3: #c09060;
    --heading-1: #e2ded6; --heading-2: #c8c4ba; --heading-3: #a09b90;
    --bullet: #d4a85a;
    --shadow-code: rgba(0,0,0,0.3);
  }
}

@media (prefers-color-scheme: light) { ${hljsCssLight} }
@media (prefers-color-scheme: dark) { ${hljsCssDark} }

* { box-sizing: border-box; }

body {
  margin: 0; padding: 32px 40px 48px;
  background: var(--bg); color: var(--text);
  font-family: Charter, 'Iowan Old Style', Georgia, 'Times New Roman', serif;
  font-size: 16px; line-height: 1.8; -webkit-font-smoothing: antialiased;
  max-width: 52em; margin-left: auto; margin-right: auto;
}

/* ── Headings ── */
h1, h2, h3, h4, h5, h6 {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-weight: 700; letter-spacing: -0.01em; margin-bottom: 0.6em;
}
h1 {
  font-size: 2em; margin-top: 0; padding-bottom: 0.4em; color: var(--heading-1);
  border-bottom: 2px solid transparent;
  border-image: linear-gradient(to right, var(--accent-1), var(--accent-3), transparent) 1;
}
h2 {
  font-size: 1.5em; margin-top: 2em; padding-bottom: 0.3em; color: var(--heading-2);
  border-bottom: 1px solid transparent;
  border-image: linear-gradient(to right, var(--accent-2), transparent 80%) 1;
}
h3 { font-size: 1.2em; margin-top: 1.8em; color: var(--heading-3); }
h4 { font-size: 1.05em; margin-top: 1.5em; color: var(--heading-3); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }

/* ── Links ── */
a {
  color: var(--link); text-decoration: none;
  background-image: linear-gradient(var(--link-hover), var(--link-hover));
  background-size: 0% 1px; background-position: 0 100%; background-repeat: no-repeat;
  transition: background-size 0.25s ease;
}
a:hover { background-size: 100% 1px; }

/* ── Inline code ── */
code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; font-size: 0.88em;
  background: var(--code-bg); padding: 0.15em 0.45em; border-radius: 5px;
  border: 1px solid var(--code-border);
}

/* ── Code blocks ── */
pre {
  background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: 10px; padding: 18px 20px; overflow-x: auto;
  box-shadow: 0 2px 8px var(--shadow-code);
  position: relative;
}
pre code {
  background: none; border: none; padding: 0; font-size: 13px; line-height: 1.6;
  box-shadow: none;
}

/* ── Blockquotes ── */
blockquote {
  margin: 1.5em 0; padding: 0.8em 1.2em;
  border-left: 3px solid var(--blockquote-border);
  background: var(--blockquote-bg); border-radius: 0 8px 8px 0;
  color: var(--blockquote-text); font-style: italic;
}
blockquote p { margin: 0.3em 0; }

/* ── Tables ── */
table {
  border-collapse: separate; border-spacing: 0; width: 100%; margin: 1.5em 0;
  border-radius: 10px; overflow: hidden;
  border: 1px solid var(--table-border);
  box-shadow: 0 1px 4px var(--shadow-code);
}
th {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  background: var(--table-header-bg); font-weight: 600; font-size: 0.85em;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary);
  padding: 10px 14px; text-align: left;
  border-bottom: 2px solid var(--accent-2);
}
td {
  padding: 10px 14px; text-align: left;
  border-bottom: 1px solid var(--table-border);
}
tr:last-child td { border-bottom: none; }
tbody tr:nth-child(even) { background: var(--table-stripe); }

/* ── Horizontal rules ── */
hr {
  border: none; height: 2px; margin: 2.5em auto;
  background: linear-gradient(to right, transparent, var(--hr-from), var(--hr-to), transparent);
  border-radius: 1px; max-width: 80%;
}

/* ── Lists ── */
ul, ol { padding-left: 1.8em; }
li { margin-bottom: 0.35em; }
ul > li { list-style: none; position: relative; }
ul > li::before {
  content: ''; position: absolute; left: -1.3em; top: 0.65em;
  width: 6px; height: 6px; border-radius: 50%; background: var(--bullet);
}
ul ul > li::before {
  background: transparent; border: 1.5px solid var(--bullet);
  width: 5px; height: 5px;
}
ol { list-style: none; counter-reset: ol-counter; }
ol > li { counter-increment: ol-counter; position: relative; }
ol > li::before {
  content: counter(ol-counter); position: absolute; left: -1.8em;
  width: 1.4em; text-align: right;
  font-size: 0.85em; font-weight: 600; color: var(--accent-2);
}

/* ── Images ── */
img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 12px var(--shadow-code); }

/* ── Paragraphs & strong/em ── */
p { margin: 0.8em 0; }
strong { font-weight: 650; color: var(--heading-1); }

/* ── Task lists ── */
.task-list-item { list-style: none; }
.task-list-item::before { display: none; }
.task-list-item input { margin-right: 0.5em; margin-left: -1.3em; }

/* ── Mermaid ── */
.mermaid { text-align: center; margin: 1.5em 0; }

/* ── First heading special case ── */
body > h1:first-child { margin-top: 0.2em; }
</style>
</head>
<body>
${renderedHTML}
${mermaidBlock}
<script>
document.addEventListener('mouseup', function() {
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  if (text && sel.rangeCount > 0) {
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    window.parent.postMessage({
      type: 'annotation',
      text: text,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }, '*');
  }
});
</script>
</body>
</html>`;
}
