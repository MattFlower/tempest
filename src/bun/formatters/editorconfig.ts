// ============================================================
// Minimal .editorconfig parser + resolver.
//
// Spec reference: https://editorconfig.org/. We support the properties
// Tempest's editor + save pipeline can act on:
//   indent_style, indent_size, tab_width, end_of_line,
//   trim_trailing_whitespace, insert_final_newline.
//
// Resolution algorithm:
//   1. Walk up from the file's directory, collecting every
//      `.editorconfig` until we hit a file with `root = true` at the
//      top-level (before any section), or the workspace root, or the
//      filesystem root.
//   2. Apply outer files first, inner files last (closer wins).
//   3. Within each file, walk sections top-to-bottom; later matching
//      sections override earlier ones. The unnamed top-of-file section
//      contributes only `root = true`.
//   4. A section applies when its glob pattern matches the file path
//      relative to the directory containing the .editorconfig file.
//
// We don't currently surface `charset` or `max_line_length` — they're
// parsed but ignored. The `unset` value works correctly: it clears the
// accumulated value so an outer file's `[*]` doesn't leak into a more
// specific inner section.
// ============================================================

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface EditorconfigSettings {
	indentStyle?: "space" | "tab";
	/** Width of one indent. May be "tab" in source, in which case we
	 *  resolve to `tabWidth` (or fall back). */
	indentSize?: number;
	tabWidth?: number;
	endOfLine?: "lf" | "crlf" | "cr";
	trimTrailingWhitespace?: boolean;
	insertFinalNewline?: boolean;
}

/** Resolve EditorConfig for a single file. Returns an empty object
 *  when no .editorconfig is found anywhere up the tree. */
export function resolveEditorconfig(
	filePath: string,
	workspacePath?: string,
): EditorconfigSettings {
	const absFile = resolve(filePath);
	const stop = workspacePath ? resolve(workspacePath) : null;
	const files = collectEditorconfigFiles(absFile, stop);
	// collectEditorconfigFiles returns innermost-first; apply outer-first
	// so inner settings overwrite.
	files.reverse();

	const acc: EditorconfigSettings = {};
	for (const path of files) {
		let raw: string;
		try {
			raw = readFileSync(path, "utf8");
		} catch {
			continue;
		}
		const parsed = parseEditorconfig(raw);
		const fromDir = dirname(path);
		const relPath = toPosix(relative(fromDir, absFile));
		for (const section of parsed.sections) {
			if (matchesGlob(section.pattern, relPath)) {
				applySection(acc, section.props);
			}
		}
	}
	// If indent_size was "tab", resolve it from tabWidth (spec).
	return acc;
}

interface ParsedFile {
	root: boolean;
	sections: Array<{ pattern: string; props: Record<string, string> }>;
}

export function parseEditorconfig(raw: string): ParsedFile {
	const lines = raw.split(/\r?\n/);
	const out: ParsedFile = { root: false, sections: [] };
	let current: { pattern: string; props: Record<string, string> } | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		if (line.startsWith(";") || line.startsWith("#")) continue;

		if (line.startsWith("[") && line.endsWith("]")) {
			// Section header. Spec puts the pattern between `[` and `]`.
			current = { pattern: line.slice(1, -1), props: {} };
			out.sections.push(current);
			continue;
		}

		const eq = line.indexOf("=");
		const colon = line.indexOf(":");
		const sep = eq >= 0 && (colon < 0 || eq < colon) ? eq : colon;
		if (sep < 0) continue;
		const key = line.slice(0, sep).trim().toLowerCase();
		const value = line.slice(sep + 1).trim();
		if (key.length === 0) continue;

		if (!current) {
			// Pre-section properties — only `root` is spec'd.
			if (key === "root" && value.toLowerCase() === "true") out.root = true;
			continue;
		}
		current.props[key] = value;
	}

	return out;
}

function applySection(
	acc: EditorconfigSettings,
	props: Record<string, string>,
): void {
	// Per the spec, "unset" clears the accumulated value. We model that
	// by deleting the key from `acc` so a later section can re-set it
	// (or leave it default). Handle tab_width before indent_size so
	// `indent_size = tab` is order-independent within a section.
	if (props.tab_width !== undefined) {
		const v = props.tab_width.toLowerCase();
		if (v === "unset") delete acc.tabWidth;
		else {
			const n = Number(v);
			if (Number.isInteger(n) && n > 0 && n <= 32) acc.tabWidth = n;
		}
	}

	for (const [k, vRaw] of Object.entries(props)) {
		const v = vRaw.toLowerCase();
		switch (k) {
			case "indent_style":
				if (v === "unset") delete acc.indentStyle;
				else if (v === "space" || v === "tab") acc.indentStyle = v;
				break;
			case "indent_size":
				if (v === "unset") delete acc.indentSize;
				else if (v === "tab") {
					// Spec: indent_size = tab → use tab_width if specified,
					// otherwise leave unset and let the editor default apply.
					if (acc.tabWidth !== undefined) acc.indentSize = acc.tabWidth;
				} else {
					const n = Number(v);
					if (Number.isInteger(n) && n > 0 && n <= 32) acc.indentSize = n;
				}
				break;
			case "tab_width":
				break;
			case "end_of_line":
				if (v === "unset") delete acc.endOfLine;
				else if (v === "lf" || v === "crlf" || v === "cr") acc.endOfLine = v;
				break;
			case "trim_trailing_whitespace":
				if (v === "unset") delete acc.trimTrailingWhitespace;
				else if (v === "true") acc.trimTrailingWhitespace = true;
				else if (v === "false") acc.trimTrailingWhitespace = false;
				break;
			case "insert_final_newline":
				if (v === "unset") delete acc.insertFinalNewline;
				else if (v === "true") acc.insertFinalNewline = true;
				else if (v === "false") acc.insertFinalNewline = false;
				break;
			// charset, max_line_length: parsed but unused.
		}
	}
}

function collectEditorconfigFiles(
	absFile: string,
	stopAt: string | null,
): string[] {
	// Walk up directory by directory looking for .editorconfig. Stop
	// when (a) we hit a file with `root = true`, (b) we move past the
	// stopAt directory, or (c) we hit the filesystem root. Returns
	// innermost-first.
	const out: string[] = [];
	let dir = dirname(absFile);
	while (true) {
		const candidate = join(dir, ".editorconfig");
		if (existsSync(candidate)) {
			try {
				if (statSync(candidate).isFile()) {
					out.push(candidate);
					let raw = "";
					try {
						raw = readFileSync(candidate, "utf8");
					} catch {
						/* ignore */
					}
					if (parseEditorconfig(raw).root) break;
				}
			} catch {
				/* ignore */
			}
		}
		if (stopAt && dir === stopAt) break;
		const parent = dirname(dir);
		if (parent === dir) break; // FS root
		dir = parent;
	}
	return out;
}

function toPosix(p: string): string {
	// EditorConfig globs are POSIX-style; normalize Windows separators
	// even though we're macOS-only today, to keep tests stable.
	return p.split(sep).join("/");
}

// ----- Glob matcher -----
//
// Supported syntax (per the .editorconfig spec):
//   *      — match any string except '/'
//   **     — match any string (including '/')
//   ?      — match any single character except '/'
//   [seq]  — match any single char in seq; [!seq] negates
//   {a,b}  — alternation
//
// We translate the glob to a regex and anchor it. Patterns with no
// '/' are treated as basename-only matches — which is what authors
// usually mean writing `[*.js]`.

export function matchesGlob(pattern: string, relPath: string): boolean {
	if (pattern === "*") {
		// Special-case: `[*]` matches every file in the directory tree.
		return true;
	}
	const re = globToRegExp(pattern);
	if (!pattern.includes("/")) {
		// Basename match for slash-free patterns.
		const base = relPath.split("/").pop() ?? relPath;
		return re.test(base);
	}
	// Patterns starting with `**/` apply at any depth.
	if (pattern.startsWith("**/")) return re.test(relPath);
	return re.test(relPath);
}

export function globToRegExp(pattern: string): RegExp {
	let i = 0;
	let out = "";
	// Stack tracks the open `{` group depth so commas inside become `|`.
	let braceDepth = 0;
	while (i < pattern.length) {
		const ch = pattern[i]!;
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				out += ".*";
				i += 2;
				// Optional trailing slash: `**/foo` should match `foo` too.
				if (pattern[i] === "/") i += 1;
			} else {
				out += "[^/]*";
				i += 1;
			}
			continue;
		}
		if (ch === "?") {
			out += "[^/]";
			i += 1;
			continue;
		}
		if (ch === "[") {
			// Char class. Copy until the closing ].
			let j = i + 1;
			let negate = false;
			if (pattern[j] === "!") {
				negate = true;
				j += 1;
			}
			let body = "";
			while (j < pattern.length && pattern[j] !== "]") {
				body += pattern[j];
				j += 1;
			}
			out += `[${negate ? "^" : ""}${body}]`;
			i = j + 1;
			continue;
		}
		if (ch === "{") {
			out += "(?:";
			braceDepth += 1;
			i += 1;
			continue;
		}
		if (ch === "}") {
			if (braceDepth > 0) {
				out += ")";
				braceDepth -= 1;
				i += 1;
				continue;
			}
			out += "\\}";
			i += 1;
			continue;
		}
		if (ch === "," && braceDepth > 0) {
			out += "|";
			i += 1;
			continue;
		}
		if (/[.+^$()|\\]/.test(ch)) {
			out += "\\" + ch;
			i += 1;
			continue;
		}
		out += ch;
		i += 1;
	}
	return new RegExp(`^${out}$`);
}
