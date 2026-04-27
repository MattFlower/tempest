// ============================================================
// Provider registry — owns the ordered list of FormatterProviders
// and runs the resolution algorithm.
//
// Resolution order (Phase 2; user overrides arrive in Phase 3):
//   1. Project-config-gated providers (Prettier, ruff, black,
//      clang-format) — first match wins. The `.prettierrc` (or similar)
//      is treated as a strong signal that the project is using the
//      tool.
//   2. Canonical language-gated providers (gofmt, rustfmt, dart format,
//      terraform fmt, shfmt) — applies just because the language
//      matches and the binary is on PATH.
//   3. LSP — for any language whose running server announced
//      documentFormattingProvider.
//
// A provider's `applies()` is the gate; the registry walks the list in
// order, returns the first one that says yes. `pickAll()` returns every
// applicable provider so the Settings UI can show "what would run for
// this file?".
// ============================================================

import type { LspRpc } from "../lsp/lsp-rpc";
import type { FormatContext, FormatterProvider } from "./provider";
import { black } from "./providers/black";
import { clangFormat } from "./providers/clang-format";
import { dartFormat } from "./providers/dart-format";
import { gofmt } from "./providers/gofmt";
import { type LspProviderDeps, makeLspProvider } from "./providers/lsp";
import { prettier } from "./providers/prettier";
import { ruff } from "./providers/ruff";
import { rustfmt } from "./providers/rustfmt";
import { shfmt } from "./providers/shfmt";
import { terraformFmt } from "./providers/terraform-fmt";

/** Languages where we register an LSP-as-provider tier. Keep aligned
 *  with the LSP recipe set; see SUPPORTED_LANGUAGES in lsp-providers.ts
 *  on the renderer side. */
export const LSP_SUPPORTED_LANGUAGES = [
	"typescript",
	"javascript",
	"typescriptreact",
	"javascriptreact",
	"python",
	"html",
	"css",
	"scss",
	"less",
	"json",
	"jsonc",
	"shell",
	"yaml",
	"dockerfile",
	"rust",
	"lua",
	"c",
	"cpp",
	"markdown",
	"go",
	"java",
];

export interface RegistryDeps {
	rpc: LspRpc;
	hasFormattingCapability: LspProviderDeps["hasFormattingCapability"];
}

export class FormatterRegistry {
	private readonly providers: FormatterProvider[];

	constructor(deps: RegistryDeps) {
		const lsp = makeLspProvider({
			rpc: deps.rpc,
			supportedLanguages: LSP_SUPPORTED_LANGUAGES,
			hasFormattingCapability: deps.hasFormattingCapability,
		});
		// Order matters: project-config-gated first, then canonical
		// language-gated, then LSP. The registry uses first-match.
		this.providers = [
			prettier, // project-config-gated; covers TS/JS/CSS/HTML/JSON/MD/YAML/etc.
			ruff, // pyproject.toml [tool.ruff]
			black, // pyproject.toml [tool.black]
			clangFormat, // .clang-format
			// canonical language-gated (no project config required):
			gofmt,
			rustfmt,
			dartFormat,
			terraformFmt,
			shfmt,
			// last tier: LSP
			lsp,
		];
	}

	/** Iterate providers whose static language list includes `languageId`.
	 *  We pre-filter on language to avoid running `applies()` for obviously
	 *  wrong combinations (e.g. asking Prettier about a `.go` file). */
	private candidatesForLanguage(languageId: string): FormatterProvider[] {
		return this.providers.filter((p) => p.languages.includes(languageId));
	}

	/** Look up a provider by its stable id. Used for the user's
	 *  `defaultFormatter` override which targets a specific provider. */
	findById(id: string): FormatterProvider | null {
		return this.providers.find((p) => p.id === id) ?? null;
	}

	async pick(ctx: FormatContext): Promise<FormatterProvider | null> {
		for (const p of this.candidatesForLanguage(ctx.languageId)) {
			if (await p.applies(ctx)) return p;
		}
		return null;
	}

	/** Pick the first applicable provider that can format a range. Range
	 *  requests must not fall back to whole-document formatting: callers
	 *  like format-on-paste only want to touch the inserted span. */
	async pickRange(ctx: FormatContext): Promise<FormatterProvider | null> {
		for (const p of this.candidatesForLanguage(ctx.languageId)) {
			if (!p.formatRange) continue;
			if (await p.applies(ctx)) return p;
		}
		return null;
	}

	/** Return every provider that applies. Used by the Settings UI to
	 *  surface "what would run for this file?" without committing to one. */
	async pickAll(ctx: FormatContext): Promise<FormatterProvider[]> {
		const out: FormatterProvider[] = [];
		for (const p of this.candidatesForLanguage(ctx.languageId)) {
			if (await p.applies(ctx)) out.push(p);
		}
		return out;
	}

	/** Every provider that nominally handles this language id, with their
	 *  current applies() verdict. Used by listFormattersForLanguage so the
	 *  UI can show installable options ("Prettier — install in project to
	 *  enable"). */
	async describeForLanguage(
		ctx: FormatContext,
	): Promise<Array<{ provider: FormatterProvider; applies: boolean }>> {
		const out: Array<{ provider: FormatterProvider; applies: boolean }> = [];
		for (const p of this.candidatesForLanguage(ctx.languageId)) {
			out.push({ provider: p, applies: await p.applies(ctx) });
		}
		return out;
	}
}
