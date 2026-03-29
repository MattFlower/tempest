import { describe, it, expect } from "bun:test";
import {
  buildMarkdownHTML,
  escapeForTemplateLiteral,
} from "./markdown-html-builder";

// ============================================================
// escapeForTemplateLiteral
// ============================================================

describe("escapeForTemplateLiteral", () => {
  it("escapes backslashes", () => {
    expect(escapeForTemplateLiteral("a\\b")).toBe("a\\\\b");
  });

  it("escapes backticks", () => {
    expect(escapeForTemplateLiteral("a`b")).toBe("a\\`b");
  });

  it("escapes dollar signs", () => {
    expect(escapeForTemplateLiteral("a$b")).toBe("a\\$b");
  });

  it("escapes all special chars together", () => {
    const input = "\\`$";
    const result = escapeForTemplateLiteral(input);
    expect(result).toBe("\\\\\\`\\$");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeForTemplateLiteral("Hello world!")).toBe("Hello world!");
  });

  it("handles empty string", () => {
    expect(escapeForTemplateLiteral("")).toBe("");
  });

  it("handles code blocks with template literals", () => {
    const input = "const x = `${value}`";
    const result = escapeForTemplateLiteral(input);
    expect(result).toBe("const x = \\`\\${value}\\`");
  });
});

// ============================================================
// buildMarkdownHTML
// ============================================================

describe("buildMarkdownHTML", () => {
  it("returns a complete HTML document", () => {
    const html = buildMarkdownHTML("# Hello");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  it("includes markdown-it CDN script", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("markdown-it");
    expect(html).toContain("cdnjs.cloudflare.com");
  });

  it("includes highlight.js CDN", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("highlight.js");
    expect(html).toContain("highlight.min.js");
  });

  it("includes highlight.js dark theme CSS", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("github-dark.min.css");
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
  });

  it("includes highlight.js light theme CSS", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("github.min.css");
    expect(html).toContain('media="(prefers-color-scheme: light)"');
  });

  it("includes mermaid CDN reference", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("mermaid");
  });

  it("includes markdown-it configuration: html, linkify, typographer", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("html: true");
    expect(html).toContain("linkify: true");
    expect(html).toContain("typographer: true");
  });

  it("includes Catppuccin dark mode CSS variables", () => {
    const html = buildMarkdownHTML("# Test");
    // Catppuccin Mocha colors from MarkdownHTMLBuilder.swift
    expect(html).toContain("--bg: #1e1e2e");
    expect(html).toContain("--text: #cdd6f4");
    expect(html).toContain("--code-bg: #181825");
    expect(html).toContain("--link: #89b4fa");
  });

  it("includes light mode CSS variables", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("--bg: #ffffff");
    expect(html).toContain("--text: #1a1a1a");
  });

  it("includes the escaped markdown content", () => {
    const html = buildMarkdownHTML("# Hello World");
    expect(html).toContain("# Hello World");
  });

  it("escapes backticks in markdown content", () => {
    const html = buildMarkdownHTML("Use `code` here");
    expect(html).toContain("Use \\`code\\` here");
  });

  it("escapes dollar signs in markdown content", () => {
    const html = buildMarkdownHTML("Price: $10");
    expect(html).toContain("Price: \\$10");
  });

  it("escapes backslashes in markdown content", () => {
    const html = buildMarkdownHTML("path\\to\\file");
    expect(html).toContain("path\\\\to\\\\file");
  });

  it("includes content div and loading div", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain('id="content"');
    expect(html).toContain('id="loading"');
  });

  it("configures mermaid with dark mode detection", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("mermaid.initialize");
    expect(html).toContain("startOnLoad: false");
  });

  it("includes highlight function with language detection", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("hljs.highlight");
    expect(html).toContain("hljs.highlightAuto");
    expect(html).toContain("ignoreIllegals: true");
  });

  it("includes code styling with SF Mono font", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("'SF Mono'");
    expect(html).toContain("'Menlo'");
    expect(html).toContain("'Consolas'");
  });

  it("handles empty markdown", () => {
    const html = buildMarkdownHTML("");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="content"');
  });

  it("includes responsive image styling", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("max-width: 100%");
  });

  it("includes table styling", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("border-collapse: collapse");
    expect(html).toContain("--table-border");
    expect(html).toContain("--table-stripe");
  });

  it("includes blockquote styling", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("--blockquote-border");
    expect(html).toContain("border-left: 4px solid");
  });

  it("includes task list styling", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("task-list-item");
  });

  it("handles mermaid code block conversion logic", () => {
    const html = buildMarkdownHTML("# Test");
    expect(html).toContain("language-mermaid");
    expect(html).toContain("mermaid.run()");
  });
});
