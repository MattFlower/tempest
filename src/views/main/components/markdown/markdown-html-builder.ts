// ============================================================
// Markdown HTML Builder — Port of MarkdownHTMLBuilder.swift
// Produces a self-contained HTML page string for rendering
// markdown with syntax highlighting and mermaid diagrams.
// Loaded in an iframe via srcdoc.
// ============================================================

// CDN URLs for libraries loaded in the iframe
const MARKDOWN_IT_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/markdown-it/14.1.0/markdown-it.min.js";
const HLJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js";
const HLJS_CSS_DARK_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css";
const HLJS_CSS_LIGHT_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css";
const MERMAID_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.1/mermaid.min.js";

/**
 * Escape markdown content for safe embedding in a JS template literal.
 * Matches the Swift MarkdownHTMLBuilder escaping.
 */
export function escapeForTemplateLiteral(content: string): string {
  return content
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

/**
 * Build a complete HTML page string that renders the given markdown.
 * This is loaded as an iframe's srcdoc attribute.
 *
 * Ported from MarkdownHTMLBuilder.swift — same CSS, same JS logic,
 * but libraries are loaded from CDN instead of bundled resources.
 */
export function buildMarkdownHTML(markdown: string): string {
  const escaped = escapeForTemplateLiteral(markdown);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" id="hljs-light" href="${HLJS_CSS_LIGHT_CDN}" media="(prefers-color-scheme: light)">
<link rel="stylesheet" id="hljs-dark" href="${HLJS_CSS_DARK_CDN}" media="(prefers-color-scheme: dark)">
<style>
:root {
  color-scheme: light dark;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --text: #1a1a1a;
    --text-secondary: #555;
    --code-bg: #f5f5f5;
    --code-border: #e0e0e0;
    --blockquote-border: #ddd;
    --blockquote-text: #666;
    --link: #0066cc;
    --table-border: #ddd;
    --table-stripe: #f9f9f9;
    --hr: #ddd;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e2e;
    --text: #cdd6f4;
    --text-secondary: #a6adc8;
    --code-bg: #181825;
    --code-border: #313244;
    --blockquote-border: #45475a;
    --blockquote-text: #a6adc8;
    --link: #89b4fa;
    --table-border: #45475a;
    --table-stripe: #1a1a2e;
    --hr: #45475a;
  }
}

body {
  margin: 0;
  padding: 24px 32px;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}
h1 { font-size: 2em; border-bottom: 1px solid var(--hr); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--hr); padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }

a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }

code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--code-border);
}

pre {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}
pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
}

blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  border-left: 4px solid var(--blockquote-border);
  color: var(--blockquote-text);
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
th, td {
  border: 1px solid var(--table-border);
  padding: 8px 12px;
  text-align: left;
}
tr:nth-child(even) { background: var(--table-stripe); }

hr { border: none; border-top: 1px solid var(--hr); margin: 2em 0; }

img { max-width: 100%; height: auto; border-radius: 4px; }

ul, ol { padding-left: 2em; }
li { margin-bottom: 0.3em; }

/* Task lists */
.task-list-item { list-style: none; margin-left: -1.5em; }
.task-list-item input { margin-right: 0.5em; }

.mermaid { text-align: center; margin: 1em 0; }

/* Loading state */
#loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
</head>
<body>
<div id="loading">Loading...</div>
<div id="content" style="display:none"></div>

<script src="${MARKDOWN_IT_CDN}"></script>
<script src="${HLJS_CDN}"></script>
<script>
(function() {
  var rawMarkdown = \`${escaped}\`;

  // Wait for markdown-it to be available
  function render() {
    if (typeof markdownit === 'undefined') {
      setTimeout(render, 50);
      return;
    }

    var md = markdownit({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function(str, lang) {
        if (lang && typeof hljs !== 'undefined') {
          try {
            var result = hljs.highlight(str, { language: lang, ignoreIllegals: true });
            return result.value;
          } catch(e) {}
        }
        if (typeof hljs !== 'undefined') {
          try {
            var result = hljs.highlightAuto(str);
            return result.value;
          } catch(e) {}
        }
        return '';
      }
    });

    var contentEl = document.getElementById('content');
    var loadingEl = document.getElementById('loading');
    contentEl.innerHTML = md.render(rawMarkdown);
    contentEl.style.display = 'block';
    loadingEl.style.display = 'none';

    // Load and run mermaid for diagram blocks
    var hasMermaid = contentEl.querySelector('pre > code.language-mermaid');
    if (hasMermaid) {
      var script = document.createElement('script');
      script.src = '${MERMAID_CDN}';
      script.onload = function() {
        if (typeof mermaid !== 'undefined') {
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
        }
      };
      document.head.appendChild(script);
    }
  }

  render();
})();
</script>
</body>
</html>`;
}
