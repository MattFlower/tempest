import { describe, expect, it } from "bun:test";
import { buildMarkdownHTML } from "./markdown-html-builder";

describe("buildMarkdownHTML", () => {
  it("escapes raw HTML blocks in markdown input", () => {
    const html = buildMarkdownHTML("<script>window.__md_injected = true</script>");

    expect(html).not.toContain("<script>window.__md_injected = true</script>");
    expect(html).toContain("&lt;script&gt;window.__md_injected = true&lt;/script&gt;");
  });

  it("adds source-line metadata to fenced code blocks", () => {
    const html = buildMarkdownHTML("```ts\nconst x = 1;\n```");

    expect(html).toMatch(/<pre[^>]*data-source-line="1"[^>]*><code class="language-ts">/);
  });

  it("adds source-line metadata to indented code blocks", () => {
    const html = buildMarkdownHTML("    const y = 2;");

    expect(html).toMatch(/<pre[^>]*data-source-line="1"[^>]*><code>/);
  });
});
