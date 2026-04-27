// ============================================================
// FormatterService — the surface index.ts wires to RPC.
//
// Owns a FormatterRegistry and exposes the two operations the renderer
// actually calls:
//   - formatBuffer(params): pick a provider, run it, return the result.
//   - listFormattersForLanguage(params): describe every nominally-eligible
//     provider with its current applies() verdict (for Settings UI).
//
// All work happens here; the RPC handler in index.ts is a thin shim.
// ============================================================

import type {
	AppConfig,
	EditorconfigSettings,
	LspRange,
	LspTextEdit,
	RepoSettings,
} from "../../shared/ipc-types";
import type { LspRpc } from "../lsp/lsp-rpc";
import { resolveFormatting } from "./config-resolver";
import { resolveEditorconfig } from "./editorconfig";
import type { FormatContext, FormatResult } from "./provider";
import { FormatterRegistry } from "./registry";

export interface FormatBufferParams {
	filePath: string;
	workspacePath?: string;
	languageId: string;
	content: string;
	options: { tabSize: number; insertSpaces: boolean };
	/** When set, format only this range. Provider must implement
	 *  `formatRange`; if it doesn't, we fall back to formatDocument. */
	range?: LspRange;
}

export type FormatBufferResult =
	| {
			kind: "fullText";
			newText: string;
			chosenFormatter: { id: string; displayName: string };
	  }
	| {
			kind: "edits";
			edits: LspTextEdit[];
			chosenFormatter: { id: string; displayName: string };
	  }
	| {
			kind: "noop";
			chosenFormatter: { id: string; displayName: string };
	  }
	| { kind: "error"; message: string };

export interface ListFormattersParams {
	languageId: string;
	filePath?: string;
	workspacePath?: string;
}

export interface ListFormattersResult {
	formatters: Array<{
		id: string;
		displayName: string;
		applies: boolean;
		/** Short human reason explaining why `applies` is what it is.
		 *  Phase 2 keeps it simple (e.g. "ready" / "not configured" /
		 *  "binary not on PATH"); Phase 3's UI can format it further. */
		reason: string;
		installHint?: string;
	}>;
}

export interface FormatterServiceDeps {
	rpc: LspRpc;
	/** Read server capabilities for (workspacePath, languageId) and
	 *  return whether `documentFormattingProvider` (or, when `range`
	 *  is true, `documentRangeFormattingProvider`) is announced. */
	hasFormattingCapability: (
		workspacePath: string | undefined,
		languageId: string,
		range: boolean,
	) => boolean;
	/** Workspace-agnostic version of the above: do any currently-running
	 *  servers for this language advertise formatting? Used by the
	 *  Settings UI's listFormattersForLanguage to filter out the LSP
	 *  tier when the user's actual server (e.g. pyright) doesn't
	 *  format. "unknown" → no server is running yet, be optimistic. */
	anyRunningServerAdvertisesFormatting: (
		languageId: string,
	) => "yes" | "no" | "unknown";
	/** Read the current AppConfig (for `formatting.defaultFormatter`
	 *  overrides and timeoutMs). */
	getConfig: () => AppConfig;
	/** Look up per-repo settings for the file's enclosing repo. May
	 *  return undefined when the workspace isn't under a managed repo. */
	getRepoSettingsFor: (
		workspacePath: string | undefined,
	) => RepoSettings | undefined;
}

export class FormatterService {
	private readonly registry: FormatterRegistry;
	private readonly deps: FormatterServiceDeps;

	constructor(deps: FormatterServiceDeps) {
		this.deps = deps;
		this.registry = new FormatterRegistry({
			rpc: deps.rpc,
			hasFormattingCapability: deps.hasFormattingCapability,
		});
	}

	async formatBuffer(params: FormatBufferParams): Promise<FormatBufferResult> {
		const ctx: FormatContext = {
			filePath: params.filePath,
			workspacePath: params.workspacePath,
			languageId: params.languageId,
			content: params.content,
			options: params.options,
		};

		// Honor user-configured forcedProvider before consulting the
		// resolution order. Per-language repo override > per-language
		// global > repo global > app global; see config-resolver.
		const resolved = resolveFormatting({
			config: this.deps.getConfig(),
			repoSettings: this.deps.getRepoSettingsFor(params.workspacePath),
			languageId: params.languageId,
		});

		let provider = resolved.forcedProvider
			? this.registry.findById(resolved.forcedProvider)
			: null;
		if (resolved.forcedProvider && !provider) {
			return {
				kind: "error",
				message: `Configured formatter '${resolved.forcedProvider}' is not registered.`,
			};
		}
		// Forced providers still have to applies() — otherwise we'd silently
		// call (e.g.) the LSP tier on a file whose language server doesn't
		// advertise formatting and report a misleading "no changes" noop.
		if (provider && !(await provider.applies(ctx))) {
			const hint = provider.installHint?.();
			const reason = `${provider.displayName} doesn't apply to this ${params.languageId} file`;
			return {
				kind: "error",
				message: hint ? `${reason}. ${hint}` : reason,
			};
		}
		if (params.range && provider && !provider.formatRange) {
			return {
				kind: "error",
				message: `${provider.displayName} does not support range formatting.`,
			};
		}
		if (!provider) {
			provider = params.range
				? await this.registry.pickRange(ctx)
				: await this.registry.pick(ctx);
		}
		if (!provider) {
			return {
				kind: "error",
				message: params.range
					? `No range formatter available for ${params.languageId}.`
					: `No formatter available for ${params.languageId}.`,
			};
		}
		const result: FormatResult = params.range
			? await provider.formatRange!(ctx, params.range)
			: await provider.formatDocument(ctx);

		const chosen = { id: provider.id, displayName: provider.displayName };
		if (result.kind === "fullText")
			return {
				kind: "fullText",
				newText: result.newText,
				chosenFormatter: chosen,
			};
		if (result.kind === "edits")
			return { kind: "edits", edits: result.edits, chosenFormatter: chosen };
		if (result.kind === "noop")
			return { kind: "noop", chosenFormatter: chosen };
		return result; // already an error
	}

	/** Resolved on-save config for a given file. The renderer's save
	 *  pipeline calls this to decide what to do before writeFileForEditor.
	 *  Doing the merge bun-side keeps the (config + repo-settings +
	 *  editorconfig) merging logic in one place. EditorConfig overrides
	 *  user config for trim/insertFinalNewline when present, since the
	 *  .editorconfig file is the project's committed code-style intent. */
	resolveSaveConfig(params: {
		workspacePath?: string;
		languageId: string;
		filePath?: string;
	}): {
		formatOnSave: boolean;
		formatOnPaste: boolean;
		trimTrailingWhitespace: boolean;
		insertFinalNewline: boolean;
		timeoutMs: number;
	} {
		const r = resolveFormatting({
			config: this.deps.getConfig(),
			repoSettings: this.deps.getRepoSettingsFor(params.workspacePath),
			languageId: params.languageId,
		});
		let trim = r.trimTrailingWhitespace;
		let insertFinal = r.insertFinalNewline;
		if (params.filePath) {
			const ec = resolveEditorconfig(params.filePath, params.workspacePath);
			if (ec.trimTrailingWhitespace !== undefined)
				trim = ec.trimTrailingWhitespace;
			if (ec.insertFinalNewline !== undefined)
				insertFinal = ec.insertFinalNewline;
		}
		return {
			formatOnSave: r.formatOnSave,
			formatOnPaste: r.formatOnPaste,
			trimTrailingWhitespace: trim,
			insertFinalNewline: insertFinal,
			timeoutMs: r.timeoutMs,
		};
	}

	/** Pure pass-through to the resolver. The renderer calls this on
	 *  file open to populate Monaco's model options (tabSize,
	 *  insertSpaces) from the project's .editorconfig. */
	getEditorconfig(params: {
		filePath: string;
		workspacePath?: string;
	}): EditorconfigSettings {
		return resolveEditorconfig(params.filePath, params.workspacePath);
	}

	async listFormattersForLanguage(
		params: ListFormattersParams,
	): Promise<ListFormattersResult> {
		const ctx: FormatContext = {
			filePath: params.filePath ?? "/__placeholder__",
			workspacePath: params.workspacePath,
			languageId: params.languageId,
			content: "",
			options: { tabSize: 2, insertSpaces: true },
		};
		const described = await this.registry.describeForLanguage(ctx);
		// Drop the LSP tier when we know it can't format this language —
		// i.e., at least one matching server is running and none advertise
		// documentFormattingProvider (the pyright case for Python). When no
		// matching server is running yet, stay optimistic and include LSP
		// since the answer depends on what spawns later.
		const lspVerdict = this.deps.anyRunningServerAdvertisesFormatting(
			params.languageId,
		);
		const filtered =
			lspVerdict === "no"
				? described.filter((d) => d.provider.id !== "lsp")
				: described;
		return {
			formatters: filtered.map(({ provider, applies }) => ({
				id: provider.id,
				displayName: provider.displayName,
				applies,
				reason: applies
					? "ready"
					: provider.installHint
						? "not available — see install hint"
						: "not configured for this file",
				...(provider.installHint
					? { installHint: provider.installHint() }
					: {}),
			})),
		};
	}
}
