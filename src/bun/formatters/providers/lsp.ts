// ============================================================
// LSP-as-formatter-provider.
//
// Different from the other providers in two ways:
//   1. We can't decide the language list at module load time — every
//      LSP server announces its own set, so the registry consults
//      `applies()` per request.
//   2. We don't spawn a process; we route through the existing LspRpc
//      handler, which returns LspTextEdit[] directly. The result
//      shape is `kind: "edits"` rather than `kind: "fullText"`.
//
// The provider is constructed with a reference to LspRpc so it can
// reach into the registry.
// ============================================================

import type { LspRange } from "../../../shared/ipc-types";
import type { LspRpc } from "../../lsp/lsp-rpc";
import type {
	FormatContext,
	FormatResult,
	FormatterProvider,
} from "../provider";

export interface LspProviderDeps {
	rpc: LspRpc;
	/** The set of Monaco language ids we have an LSP recipe for. The
	 *  registry uses this to filter the languages we offer LSP for. */
	supportedLanguages: readonly string[];
	/** Look up whether a server is running for (workspacePath, languageId)
	 *  and announced documentFormattingProvider in its capabilities. We
	 *  pass this in so the provider doesn't depend directly on
	 *  LspServerRegistry — keeps imports clean. */
	hasFormattingCapability: (
		workspacePath: string | undefined,
		languageId: string,
		range: boolean,
	) => boolean;
}

export function makeLspProvider(deps: LspProviderDeps): FormatterProvider {
	return {
		id: "lsp",
		displayName: "LSP",
		languages: deps.supportedLanguages,
		async applies(ctx: FormatContext): Promise<boolean> {
			if (!ctx.workspacePath) return false;
			if (!deps.supportedLanguages.includes(ctx.languageId)) return false;
			return deps.hasFormattingCapability(
				ctx.workspacePath,
				ctx.languageId,
				false,
			);
		},
		async formatDocument(ctx: FormatContext): Promise<FormatResult> {
			if (!ctx.workspacePath)
				return { kind: "error", message: "LSP requires workspacePath" };
			const result = await deps.rpc.formatting({
				workspacePath: ctx.workspacePath,
				uri: filePathToUri(ctx.filePath),
				languageId: ctx.languageId,
				options: ctx.options,
			});
			if (result.edits.length === 0) return { kind: "noop" };
			return { kind: "edits", edits: result.edits };
		},
		async formatRange(
			ctx: FormatContext,
			range: LspRange,
		): Promise<FormatResult> {
			if (!ctx.workspacePath)
				return { kind: "error", message: "LSP requires workspacePath" };
			if (
				!deps.hasFormattingCapability(ctx.workspacePath, ctx.languageId, true)
			) {
				return {
					kind: "error",
					message: "LSP range formatting is not available",
				};
			}
			const result = await deps.rpc.rangeFormatting({
				workspacePath: ctx.workspacePath,
				uri: filePathToUri(ctx.filePath),
				languageId: ctx.languageId,
				range,
				options: ctx.options,
			});
			if (result.edits.length === 0) return { kind: "noop" };
			return { kind: "edits", edits: result.edits };
		},
	};
}

function filePathToUri(filePath: string): string {
	return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
}
