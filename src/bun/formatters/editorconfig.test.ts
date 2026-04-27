// Unit tests for the .editorconfig parser, glob matcher, and resolver.
// We write real fixtures into a tmpdir so the resolver exercises the
// same fs walks production code does.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	globToRegExp,
	matchesGlob,
	parseEditorconfig,
	resolveEditorconfig,
} from "./editorconfig";

describe("globToRegExp", () => {
	it("translates single-star, double-star, and braces", () => {
		expect("foo.js").toMatch(globToRegExp("*.js"));
		expect("foo.go").not.toMatch(globToRegExp("*.js"));
		expect("a.js").toMatch(globToRegExp("*.{js,ts}"));
		expect("a.ts").toMatch(globToRegExp("*.{js,ts}"));
		expect("a.go").not.toMatch(globToRegExp("*.{js,ts}"));
		// **: any path including slashes
		expect("nested/dir/file.go").toMatch(globToRegExp("**.go"));
		expect("file.go").toMatch(globToRegExp("**.go"));
		// ? matches one char
		expect("a.js").toMatch(globToRegExp("?.js"));
		expect("ab.js").not.toMatch(globToRegExp("?.js"));
		// char classes
		expect("foo.c").toMatch(globToRegExp("foo.[ch]"));
		expect("foo.h").toMatch(globToRegExp("foo.[ch]"));
		expect("foo.s").not.toMatch(globToRegExp("foo.[ch]"));
	});
});

describe("matchesGlob", () => {
	it("treats slash-free patterns as basename-only", () => {
		expect(matchesGlob("*.py", "foo.py")).toBe(true);
		expect(matchesGlob("*.py", "deep/nested/foo.py")).toBe(true);
		expect(matchesGlob("*.py", "foo.go")).toBe(false);
	});
	it("respects path separators when glob includes a slash", () => {
		expect(matchesGlob("src/**/*.go", "src/cmd/main.go")).toBe(true);
		expect(matchesGlob("src/**/*.go", "lib/main.go")).toBe(false);
	});
	it("[*] matches everything", () => {
		expect(matchesGlob("*", "any/path/to/anything")).toBe(true);
	});
});

describe("parseEditorconfig", () => {
	it("captures root and per-section properties; values are trimmed", () => {
		const text = [
			"# top",
			"root = true",
			"",
			"[*]",
			"indent_style = space",
			"indent_size = 2",
			"trim_trailing_whitespace = true",
			"",
			"[*.py]",
			"indent_size = 4",
		].join("\n");
		const p = parseEditorconfig(text);
		expect(p.root).toBe(true);
		expect(p.sections.length).toBe(2);
		expect(p.sections[0]?.pattern).toBe("*");
		expect(p.sections[0]?.props.indent_style).toBe("space");
		expect(p.sections[1]?.props.indent_size).toBe("4");
	});
});

describe("resolveEditorconfig", () => {
	let tmpRoot: string;

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "tempest-editorconfig-"));
	});
	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns empty when no .editorconfig exists up the tree", () => {
		const ws = join(tmpRoot, "no-config");
		mkdirSync(join(ws, "src"), { recursive: true });
		const r = resolveEditorconfig(join(ws, "src/foo.ts"), ws);
		expect(r).toEqual({});
	});

	it("applies [*] from a single root .editorconfig", () => {
		const ws = join(tmpRoot, "simple");
		mkdirSync(join(ws, "src"), { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			[
				"root = true",
				"[*]",
				"indent_style = space",
				"indent_size = 2",
				"trim_trailing_whitespace = true",
				"insert_final_newline = true",
			].join("\n"),
		);
		const r = resolveEditorconfig(join(ws, "src/foo.ts"), ws);
		expect(r.indentStyle).toBe("space");
		expect(r.indentSize).toBe(2);
		expect(r.trimTrailingWhitespace).toBe(true);
		expect(r.insertFinalNewline).toBe(true);
	});

	it("more specific section overrides less specific within one file", () => {
		const ws = join(tmpRoot, "specificity");
		mkdirSync(join(ws, "src"), { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			[
				"root = true",
				"[*]",
				"indent_size = 2",
				"[*.py]",
				"indent_size = 4",
			].join("\n"),
		);
		expect(resolveEditorconfig(join(ws, "src/foo.ts"), ws).indentSize).toBe(2);
		expect(resolveEditorconfig(join(ws, "src/foo.py"), ws).indentSize).toBe(4);
	});

	it("inner .editorconfig overrides outer until 'root = true' is reached", () => {
		const ws = join(tmpRoot, "nested");
		mkdirSync(join(ws, "frontend/src"), { recursive: true });
		// Outer file (root = true at the workspace).
		writeFileSync(
			join(ws, ".editorconfig"),
			["root = true", "[*]", "indent_style = space", "indent_size = 2"].join(
				"\n",
			),
		);
		// Inner file overrides indent_size for the frontend subtree.
		writeFileSync(
			join(ws, "frontend", ".editorconfig"),
			["[*]", "indent_size = 4"].join("\n"),
		);
		const r = resolveEditorconfig(join(ws, "frontend/src/foo.ts"), ws);
		expect(r.indentStyle).toBe("space"); // from outer
		expect(r.indentSize).toBe(4); // overridden by inner
	});

	it("respects 'unset' to clear an outer setting", () => {
		const ws = join(tmpRoot, "unset");
		mkdirSync(join(ws, "vendor"), { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			["root = true", "[*]", "trim_trailing_whitespace = true"].join("\n"),
		);
		writeFileSync(
			join(ws, "vendor", ".editorconfig"),
			["[*]", "trim_trailing_whitespace = unset"].join("\n"),
		);
		const r = resolveEditorconfig(join(ws, "vendor/legacy.js"), ws);
		expect(r.trimTrailingWhitespace).toBeUndefined();
	});

	it("end_of_line and indent_style are normalized to lowercase enums", () => {
		const ws = join(tmpRoot, "enums");
		mkdirSync(ws, { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			["root = true", "[*]", "end_of_line = LF", "indent_style = TAB"].join(
				"\n",
			),
		);
		const r = resolveEditorconfig(join(ws, "foo.txt"), ws);
		expect(r.endOfLine).toBe("lf");
		expect(r.indentStyle).toBe("tab");
	});

	it("indent_size = tab resolves to tab_width when set", () => {
		const ws = join(tmpRoot, "tab-indent");
		mkdirSync(ws, { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			[
				"root = true",
				"[*]",
				"indent_style = tab",
				"tab_width = 8",
				"indent_size = tab",
			].join("\n"),
		);
		const r = resolveEditorconfig(join(ws, "foo.go"), ws);
		expect(r.indentStyle).toBe("tab");
		expect(r.tabWidth).toBe(8);
		expect(r.indentSize).toBe(8);
	});

	it("indent_size = tab is independent of tab_width property order", () => {
		const ws = join(tmpRoot, "tab-indent-order");
		mkdirSync(ws, { recursive: true });
		writeFileSync(
			join(ws, ".editorconfig"),
			[
				"root = true",
				"[*]",
				"indent_style = tab",
				"indent_size = tab",
				"tab_width = 4",
			].join("\n"),
		);
		const r = resolveEditorconfig(join(ws, "foo.go"), ws);
		expect(r.tabWidth).toBe(4);
		expect(r.indentSize).toBe(4);
	});
});
