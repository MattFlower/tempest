// ============================================================
// MonacoEditorPane — renders a file in the Monaco code editor.
// Loads file content via RPC, supports Cmd+S save, and uses
// the Espresso Libre dark theme.
// ============================================================

import Editor, { loader, type OnMount } from "@monaco-editor/react";
import type * as MonacoNs from "monaco-editor";
import type { editor, IDisposable } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LspTextEdit } from "../../../../shared/ipc-types";

// monaco-vim is pre-built as a self-contained ESM bundle (src/vendor/monaco-vim.bundle.js)
// that resolves monaco-editor imports from window.monaco at runtime.
// Loaded dynamically via import() to avoid Bun's bundler pulling in monaco-editor ESM.
type VimMode = { dispose(): void };
type VimCodeMirrorAdapter = { editor?: editor.IStandaloneCodeEditor };
type VimApi = {
	Vim: {
		defineEx: (
			name: string,
			shortName: string,
			fn: (cm: VimCodeMirrorAdapter, ...args: any[]) => void,
		) => void;
		/** Map a key sequence to an ex-command or another key sequence. The
		 *  ctx string scopes the binding to a vim mode: 'normal', 'insert',
		 *  'visual', etc. */
		map?: (lhs: string, rhs: string, ctx?: string) => void;
	};
};
let initVimModeFn:
	| ((ed: editor.IStandaloneCodeEditor, statusBar?: HTMLElement) => VimMode)
	| null = null;
let vimApi: VimApi | null = null;
let loadMonacoVimPromise: Promise<void> | null = null;
type SaveOptions = { force?: boolean };
type VimEditorHandlers = {
	save: (options?: SaveOptions) => Promise<boolean>;
	close: () => void;
	jumpToMarker: (which: "first" | "last") => void;
};
const vimEditorHandlers = new WeakMap<
	editor.IStandaloneCodeEditor,
	VimEditorHandlers
>();
let vimExCommandsRegistered = false;

function handlerForVimEditor(
	cm: VimCodeMirrorAdapter,
): VimEditorHandlers | undefined {
	const ed = cm?.editor;
	return ed ? vimEditorHandlers.get(ed) : undefined;
}

function registerVimExCommands(Vim: VimApi["Vim"]) {
	if (vimExCommandsRegistered) return;
	vimExCommandsRegistered = true;

	// monaco-vim stores ex commands globally, while Tempest keeps inactive
	// Monaco tabs mounted. Always route through the editor instance that
	// invoked the ex command instead of closing over whichever pane registered
	// the command last.
	Vim.defineEx("write", "w", (cm) => {
		void handlerForVimEditor(cm)?.save({ force: true });
	});
	Vim.defineEx("quit", "q", (cm) => {
		handlerForVimEditor(cm)?.close();
	});
	Vim.defineEx("wquit", "wq", (cm) => {
		const handler = handlerForVimEditor(cm);
		if (!handler) return;
		void handler.save({ force: true }).then((saved) => {
			if (saved) handler.close();
		});
	});

	Vim.defineEx("symbols", "symbols", (cm) => {
		cm.editor?.getAction("editor.action.quickOutline")?.run();
	});
	Vim.map?.("gO", ":symbols", "normal");

	Vim.defineEx("sighelp", "sighelp", (cm) => {
		cm.editor?.getAction("editor.action.triggerParameterHints")?.run();
	});
	Vim.map?.("gK", ":sighelp", "normal");

	Vim.defineEx("def", "def", (cm) => {
		cm.editor?.getAction("editor.action.revealDefinition")?.run();
	});
	Vim.map?.("gd", ":def", "normal");

	Vim.defineEx("refs", "refs", (cm) => {
		cm.editor?.getAction("editor.action.goToReferences")?.run();
	});
	Vim.map?.("gr", ":refs", "normal");

	Vim.defineEx("hover", "hover", (cm) => {
		cm.editor?.getAction("editor.action.showHover")?.run();
	});
	Vim.map?.("K", ":hover", "normal");

	Vim.defineEx("diagnext", "diagnext", (cm) => {
		cm.editor?.getAction("editor.action.marker.next")?.run();
	});
	Vim.map?.("]d", ":diagnext", "normal");

	Vim.defineEx("diagprev", "diagprev", (cm) => {
		cm.editor?.getAction("editor.action.marker.prev")?.run();
	});
	Vim.map?.("[d", ":diagprev", "normal");

	Vim.defineEx("diagfirst", "diagfirst", (cm) => {
		handlerForVimEditor(cm)?.jumpToMarker("first");
	});
	Vim.map?.("[D", ":diagfirst", "normal");
	Vim.defineEx("diaglast", "diaglast", (cm) => {
		handlerForVimEditor(cm)?.jumpToMarker("last");
	});
	Vim.map?.("]D", ":diaglast", "normal");

	Vim.defineEx("rename", "rename", (cm) => {
		cm.editor?.getAction("editor.action.rename")?.run();
	});
	Vim.map?.("<leader>cr", ":rename", "normal");

	Vim.defineEx("codeaction", "codeaction", (cm) => {
		cm.editor?.getAction("editor.action.quickFix")?.run();
	});
	Vim.map?.("<leader>ca", ":codeaction", "normal");
}

const loadMonacoVim = async (): Promise<void> => {
	if (initVimModeFn) return;
	if (loadMonacoVimPromise) return loadMonacoVimPromise;
	loadMonacoVimPromise = (async () => {
		// Fetch the pre-built bundle and evaluate it as a blob URL module.
		// Native import() doesn't work with Electrobun's views:// protocol,
		// so we fetch + create an object URL to load the ESM bundle.
		const resp = await fetch("monaco-vim.bundle.js");
		const text = await resp.text();
		const blob = new Blob([text], { type: "application/javascript" });
		const url = URL.createObjectURL(blob);
		const mod = await import(/* @vite-ignore */ url);
		URL.revokeObjectURL(url);
		initVimModeFn = mod.initVimMode;
		vimApi = mod.VimMode as VimApi;
	})().finally(() => {
		loadMonacoVimPromise = null;
	});
	return loadMonacoVimPromise;
};

import { PaneTabKind } from "../../../../shared/ipc-types";
import { createTab } from "../../models/pane-node";
import { addTab } from "../../state/actions";
import { api } from "../../state/rpc-client";
import { useStore } from "../../state/store";
import { ImportLinkProvider } from "./import-link-provider";
import {
	JSONNET_LANGUAGE_ID,
	jsonnetLanguageConfiguration,
	jsonnetMonarchLanguage,
} from "./jsonnet-language";
import { attachLsp, type LspBridgeHandle } from "./lsp/lsp-bridge";
import {
	bindMonacoForDiagnostics,
	flushDiagnosticsFor,
} from "./lsp/lsp-diagnostics";
import { acquireLspProviders, registerModelContext } from "./lsp/lsp-providers";
import {
	TEMPEST_LIGHT_THEME_NAME,
	TEMPEST_THEME_NAME,
	tempestLightTheme,
	tempestTheme,
} from "./tempest-theme";

// Configure Monaco to load from local bundled files
loader.config({ paths: { vs: "./monaco-editor/min/vs" } });

// Disable Monaco's bundled TS/JS providers that we now serve via LSP. Doing
// this at loader.init time (rather than in handleEditorMount) ensures the
// TypeScript module honours the config when it first registers providers —
// configuring after the providers are already attached doesn't reliably
// retract them in monaco-editor 0.55.x.
//
// We construct the ModeConfiguration explicitly rather than spreading the
// existing object, because some monaco builds expose modeConfiguration as
// a getter that doesn't enumerate all fields, and a spread would leave
// stale `undefined` values that monaco interprets as "use default" (true).
loader
	.init()
	.then((monaco) => {
		const ts = monaco.languages.typescript;
		if (!ts) return; // monaco bundle without typescript support — nothing to do
		for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
			defaults.setDiagnosticsOptions({ noSemanticValidation: true });
			defaults.setModeConfiguration({
				// Keep the bundled providers we genuinely don't implement via LSP.
				// Phase 4 dropped signatureHelp / codeActions / inlayHints from
				// this list now that LSP serves them. Formatting and document
				// highlights remain bundled-only for now (Phase 5+).
				onTypeFormattingEdits: true,
				documentRangeFormattingEdits: true,
				documentHighlights: true,
				// Disable everything our LSP serves — duplicates are confusing
				// and Monaco's bundled versions are project-blind.
				completionItems: false,
				hovers: false,
				definitions: false,
				references: false,
				rename: false,
				documentSymbols: false,
				diagnostics: false,
				signatureHelp: false,
				codeActions: false,
				inlayHints: false,
			});
		}
		// Same treatment for Monaco's bundled JSON/HTML/CSS/SCSS/LESS language
		// services — when our vscode-langservers-extracted servers are running,
		// Monaco's bundled providers would otherwise produce duplicate hovers
		// and "Definitions (N)" peek entries. The bundled services live under
		// monaco.languages.{json,html,css}.* with similar API shape, so we
		// reuse the same disable list.
		//
		// documentRangeFormattingEdits is also disabled here because the
		// vscode-langservers-extracted servers serve textDocument/formatting
		// and rangeFormatting; leaving Monaco's bundled formatter on would
		// produce a "multiple formatters available" picker for these files.
		// TS/JS keep the bundled formatter on — typescript-language-server
		// does not advertise a formatting provider.
		const disabledModeConfig = {
			onTypeFormattingEdits: true,
			documentFormattingEdits: false,
			documentRangeFormattingEdits: false,
			documentHighlights: true,
			completionItems: false,
			hovers: false,
			definitions: false,
			references: false,
			rename: false,
			documentSymbols: false,
			diagnostics: false,
			signatureHelp: false,
			codeActions: false,
			inlayHints: false,
		};
		for (const defaults of [
			monaco.languages.json?.jsonDefaults,
			monaco.languages.html?.htmlDefaults,
			monaco.languages.css?.cssDefaults,
			monaco.languages.css?.scssDefaults,
			monaco.languages.css?.lessDefaults,
		]) {
			// Each module is optional in the bundle. If it's not present (the user
			// disabled it via custom worker setup), skip silently.
			if (!defaults) continue;
			try {
				defaults.setModeConfiguration({ ...disabledModeConfig });
			} catch (err) {
				console.warn(
					"[MonacoEditor] failed to disable bundled language service:",
					err,
				);
			}
		}
		console.log(
			"[MonacoEditor] disabled bundled TS/JS/JSON/HTML/CSS hovers + definitions; LSP now exclusive",
		);

		// Register an editor opener so Monaco's "Go to Definition" (and similar
		// navigations to a different file) actually open the target. Without this,
		// Monaco has no IEditorService for cross-file navigation: peek view shows
		// a result but jumping does nothing.
		//
		// Our LSP returns a `file://` URI + range; we route the open through
		// Tempest's tab system (createTab → addTab on the focused pane), the same
		// path the existing Cmd+click-on-import handler uses.
		try {
			monaco.editor.registerEditorOpener({
				openCodeEditor: async (
					_source: editor.ICodeEditor,
					resource: { scheme: string; path: string; toString(): string },
					selectionOrPosition?: {
						lineNumber?: number;
						startLineNumber?: number;
					},
				) => {
					if (resource.scheme !== "file") return false;

					// Same-document navigation: let Monaco handle it (it'll just move
					// the cursor + reveal). Returning false means "I'm not handling it".
					const sourceModel = _source.getModel();
					if (
						sourceModel &&
						sourceModel.uri.toString() === resource.toString()
					) {
						return false;
					}

					const filePath = resource.path;
					const label = filePath.split("/").pop() ?? "Editor";

					// Extract a line number from the navigation target. selectionOrPosition
					// can be either a Range (selection) or a Position (cursor target).
					let lineNumber: number | undefined;
					if (selectionOrPosition) {
						if ("lineNumber" in selectionOrPosition) {
							lineNumber = selectionOrPosition.lineNumber;
						} else if ("startLineNumber" in selectionOrPosition) {
							lineNumber = selectionOrPosition.startLineNumber;
						}
					}

					// Lazy-import the store + tab helpers to avoid a static dep cycle:
					// pane-node.ts and store.ts depend transitively on this file.
					const [{ useStore }, paneNode, { PaneTabKind }] = await Promise.all([
						import("../../state/store"),
						import("../../models/pane-node"),
						import("../../../../shared/ipc-types"),
					]);
					const { focusedPaneId } = useStore.getState();
					if (!focusedPaneId) return false;

					const config = useStore.getState().config;
					const isMonaco = config?.editor === "monaco";
					const tab = paneNode.createTab(PaneTabKind.Editor, label, {
						...(isMonaco ? {} : { terminalId: crypto.randomUUID() }),
						editorFilePath: filePath,
						...(lineNumber !== undefined
							? { editorLineNumber: lineNumber }
							: {}),
					});

					const { addTab } = await import("../../state/actions");
					addTab(focusedPaneId, tab);
					return true;
				},
			});
		} catch (err) {
			console.error("[MonacoEditor] registerEditorOpener failed:", err);
		}
	})
	.catch((err) => {
		console.error("[MonacoEditor] loader.init failed:", err);
	});

interface MonacoEditorPaneProps {
	filePath: string;
	workspacePath?: string;
	lineNumber?: number;
	isFocused: boolean;
	onCloseRequest?: () => void;
}

function displayPathForHeader(
	filePath: string,
	workspacePath?: string,
): string {
	const normalizedFilePath = filePath.replace(/\\/g, "/");
	const normalizedWorkspacePath = workspacePath
		?.replace(/\\/g, "/")
		.replace(/\/+$/, "");

	if (
		normalizedWorkspacePath &&
		normalizedFilePath.startsWith(normalizedWorkspacePath + "/")
	) {
		return normalizedFilePath.slice(normalizedWorkspacePath.length + 1);
	}

	return normalizedFilePath;
}

export function MonacoEditorPane({
	filePath,
	workspacePath,
	lineNumber,
	isFocused,
	onCloseRequest,
}: MonacoEditorPaneProps) {
	const themeMode = useStore((s) => s.config?.theme ?? "dark");
	const monacoThemeName =
		themeMode === "light" ? TEMPEST_LIGHT_THEME_NAME : TEMPEST_THEME_NAME;

	const [content, setContent] = useState<string | null>(null);
	const [language, setLanguage] = useState("plaintext");
	const [error, setError] = useState<string | null>(null);
	const [isDirty, setIsDirty] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const [editorReady, setEditorReady] = useState(false);

	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	// Monaco namespace captured at mount time. Needed by vim ex-commands
	// that read marker state (e.g. jump to first/last diagnostic) since
	// monaco.editor.getModelMarkers isn't reachable from the editor instance.
	const monacoNsRef = useRef<typeof MonacoNs | null>(null);
	const currentContentRef = useRef<string>("");
	const lastSavedContentRef = useRef<string>("");
	const isSavingRef = useRef(false);
	const themeRegistered = useRef(false);
	const vimModeRef = useRef<VimMode | null>(null);
	const statusBarRef = useRef<HTMLDivElement>(null);
	// Monaco link providers are registered globally; capture their disposables
	// so they don't accumulate across editor mounts (e.g., tab switches / remounts).
	const disposablesRef = useRef<IDisposable[]>([]);
	// LSP bridge for this editor's model + the release function for the
	// global provider refcount. Both stay null when LSP isn't applicable
	// for this file (no recipe, or no workspacePath).
	const lspBridgeRef = useRef<LspBridgeHandle | null>(null);
	const lspReleaseRef = useRef<(() => void) | null>(null);
	const lspContextDisposeRef = useRef<(() => void) | null>(null);

	const vimEnabled = useStore((s) => s.config?.monacoVimMode ?? false);
	const headerPath = useMemo(
		() => displayPathForHeader(filePath, workspacePath),
		[filePath, workspacePath],
	);

	// Load file content on mount
	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const result = await api.readFileForEditor(filePath);
				if (!cancelled) {
					setContent(result.content);
					setLanguage(result.language);
					currentContentRef.current = result.content;
					lastSavedContentRef.current = result.content;
					setIsDirty(false);
				}
			} catch (err: any) {
				if (!cancelled) setError(err.message ?? String(err));
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [filePath]);

	const [saveStatus, setSaveStatus] = useState<string | null>(null);

	// Save handler — runs the save pipeline:
	//   1. resolve save-time config for this file
	//   2. format the buffer (if formatOnSave)
	//   3. trim trailing whitespace (if enabled)
	//   4. ensure final newline (if enabled)
	//   5. push the result back into the Monaco model
	//   6. write to disk
	// Errors at any stage are logged + surfaced in the header status
	// string ("Formatted with Prettier", "Formatter failed: ...", etc.)
	// but never block the actual write.
	const handleSave = useCallback(async (options: SaveOptions = {}) => {
		if (isSavingRef.current) return false;
		const editor = editorRef.current;
		const model = editor?.getModel() ?? null;
		const initialContent = model?.getValue() ?? currentContentRef.current;
		if (
			!options.force &&
			!isDirty &&
			initialContent === lastSavedContentRef.current
		) {
			return true;
		}
		isSavingRef.current = true;
		setIsSaving(true);
		setSaveStatus(null);
		try {
			let content = initialContent;
			let sourceVersion = model?.getVersionId() ?? null;

			const refreshFromModel = () => {
				if (!model) return;
				content = model.getValue();
				currentContentRef.current = content;
				sourceVersion = model.getVersionId();
			};
			const modelChangedSince = (version: number | null) =>
				model !== null && version !== null && model.getVersionId() !== version;

			const saveCfg = await api.resolveSaveConfig({
				workspacePath,
				languageId: language,
				filePath,
			});
			// The user may have typed while config was resolving. Always run
			// the rest of the pipeline against the current model contents.
			if (modelChangedSince(sourceVersion)) refreshFromModel();

			// 1. format-on-save
			if (saveCfg.formatOnSave && model) {
				const fmtVersion = model.getVersionId();
				const opts = model.getOptions();
				const fmtResult = await api.formatBuffer({
					filePath,
					workspacePath,
					languageId: language,
					content,
					options: { tabSize: opts.tabSize, insertSpaces: opts.insertSpaces },
				});

				if (model.getVersionId() !== fmtVersion) {
					// Avoid applying stale formatter edits over newer user input.
					refreshFromModel();
					setSaveStatus("Skipped formatter; buffer changed during save");
				} else {
					const r = fmtResult.result;
					if (r.kind === "fullText") {
						content = r.newText;
						setSaveStatus(`Formatted with ${r.chosenFormatter.displayName}`);
					} else if (r.kind === "edits") {
						// Apply edits in reverse position order so earlier offsets
						// aren't invalidated by later replacements. pushEditOperations
						// also handles this internally, but sorting matches Monaco's
						// expectations and keeps the resulting content predictable.
						const sorted = [...r.edits].sort((a, b) => {
							if (a.range.start.line !== b.range.start.line) {
								return b.range.start.line - a.range.start.line;
							}
							return b.range.start.character - a.range.start.character;
						});
						model.pushEditOperations(
							null,
							sorted.map((e) => ({
								range: {
									startLineNumber: e.range.start.line + 1,
									startColumn: e.range.start.character + 1,
									endLineNumber: e.range.end.line + 1,
									endColumn: e.range.end.character + 1,
								},
								text: e.newText,
							})),
							() => null,
						);
						refreshFromModel();
						setSaveStatus(`Formatted with ${r.chosenFormatter.displayName}`);
					} else if (r.kind === "noop") {
						setSaveStatus(`No changes from ${r.chosenFormatter.displayName}`);
					} else {
						// error — log + show in header but proceed with write
						console.warn("[MonacoEditor] format on save failed:", r.message);
						setSaveStatus(`Formatter: ${r.message}`);
					}
				}
			}

			// 2. trim trailing whitespace (renderer-side string op)
			if (saveCfg.trimTrailingWhitespace) {
				content = content.replace(/[ \t]+$/gm, "");
			}
			// 3. ensure final newline
			if (
				saveCfg.insertFinalNewline &&
				content.length > 0 &&
				!content.endsWith("\n")
			) {
				content += "\n";
			}

			// 4. push final content back into the model so the editor
			//    reflects what's about to be on disk. Only replace the model
			//    if it is still at the version this pipeline read.
			if (model) {
				if (modelChangedSince(sourceVersion)) {
					refreshFromModel();
					setSaveStatus("Skipped save actions; buffer changed during save");
				} else if (content !== model.getValue()) {
					model.pushEditOperations(
						null,
						[
							{
								range: model.getFullModelRange(),
								text: content,
							},
						],
						() => null,
					);
					refreshFromModel();
				}
			} else {
				currentContentRef.current = content;
			}

			// 5. write. If the user types while the write is in flight,
			// keep the dirty flag set: the bytes on disk are the snapshot we
			// wrote, not the newer model contents.
			const writeVersion = model?.getVersionId() ?? null;
			await api.writeFileForEditor(filePath, content);
			lastSavedContentRef.current = content;
			if (
				model &&
				writeVersion !== null &&
				model.getVersionId() !== writeVersion
			) {
				currentContentRef.current = model.getValue();
				setIsDirty(currentContentRef.current !== lastSavedContentRef.current);
				setSaveStatus("Saved; unsaved changes remain");
			} else {
				currentContentRef.current = content;
				setIsDirty(false);
			}
			return true;
		} catch (err: any) {
			console.error("[MonacoEditor] save failed:", err);
			setSaveStatus(`Save failed: ${err?.message ?? String(err)}`);
			return false;
		} finally {
			isSavingRef.current = false;
			setIsSaving(false);
		}
	}, [filePath, isDirty, workspacePath, language]);

	// Clear the transient save status after a few seconds so the header
	// doesn't get stuck showing "Formatted with X" forever.
	useEffect(() => {
		if (!saveStatus) return;
		const id = setTimeout(() => setSaveStatus(null), 3000);
		return () => clearTimeout(id);
	}, [saveStatus]);

	// Refs so vim ex-commands and keydown handlers always see the latest
	// callbacks without re-registering effects.
	const onCloseRef = useRef(onCloseRequest);
	onCloseRef.current = onCloseRequest;
	const handleSaveRef = useRef(handleSave);
	handleSaveRef.current = handleSave;

	// Cmd+S to save, Cmd+W to close tab
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (!isFocused || !e.metaKey) return;
			if (e.key === "s") {
				e.preventDefault();
				handleSaveRef.current();
			} else if (e.key === "w") {
				e.preventDefault();
				onCloseRef.current?.();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isFocused]);

	// Init/dispose vim mode when the setting changes or editor mounts
	useEffect(() => {
		if (!vimEnabled || !editorReady) return;
		const ed = editorRef.current;
		const bar = statusBarRef.current;
		if (!ed || !bar) return;

		let disposed = false;
		const jumpToMarker = (which: "first" | "last") => {
			const monacoNs = monacoNsRef.current;
			const model = ed.getModel();
			if (!monacoNs || !model) return;
			const markers = monacoNs.editor.getModelMarkers({
				resource: model.uri,
			});
			if (markers.length === 0) return;
			const sorted = [...markers].sort(
				(a, b) =>
					a.startLineNumber - b.startLineNumber ||
					a.startColumn - b.startColumn,
			);
			const target = which === "first" ? sorted[0] : sorted[sorted.length - 1];
			if (!target) return;
			const pos = {
				lineNumber: target.startLineNumber,
				column: target.startColumn,
			};
			ed.setPosition(pos);
			ed.revealPositionInCenter(pos);
			ed.focus();
		};

		(async () => {
			if (!initVimModeFn) await loadMonacoVim();
			if (disposed || !initVimModeFn) return;
			vimModeRef.current = initVimModeFn(ed, bar);

			if (vimApi) {
				vimEditorHandlers.set(ed, {
					save: (options) => handleSaveRef.current(options),
					close: () => onCloseRef.current?.(),
					jumpToMarker,
				});
				registerVimExCommands(vimApi.Vim);
			}
		})();

		return () => {
			disposed = true;
			vimEditorHandlers.delete(ed);
			vimModeRef.current?.dispose();
			vimModeRef.current = null;
		};
	}, [vimEnabled, editorReady]);

	// Dispose any Monaco global registrations (e.g. link providers) registered
	// by handleEditorMount when the component unmounts. Idempotent: the array
	// is cleared after disposal so re-mounts start fresh.
	useEffect(() => {
		return () => {
			for (const d of disposablesRef.current) {
				try {
					d.dispose();
				} catch {
					/* ignore */
				}
			}
			disposablesRef.current = [];
			// Tear down LSP wiring: the bridge sends didClose, the provider
			// refcount drops, and the model context map drops this entry.
			try {
				lspBridgeRef.current?.dispose();
			} catch {
				/* ignore */
			}
			lspBridgeRef.current = null;
			try {
				lspReleaseRef.current?.();
			} catch {
				/* ignore */
			}
			lspReleaseRef.current = null;
			try {
				lspContextDisposeRef.current?.();
			} catch {
				/* ignore */
			}
			lspContextDisposeRef.current = null;
		};
	}, []);

	const handleEditorMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;
		monacoNsRef.current = monaco;
		setEditorReady(true);

		// Register dark and light themes once
		if (!themeRegistered.current) {
			monaco.editor.defineTheme(TEMPEST_THEME_NAME, tempestTheme);
			monaco.editor.defineTheme(TEMPEST_LIGHT_THEME_NAME, tempestLightTheme);
			themeRegistered.current = true;

			// Register Jsonnet — Monaco doesn't ship a built-in for it.
			const langs = monaco.languages.getLanguages();
			if (!langs.some((l: { id: string }) => l.id === JSONNET_LANGUAGE_ID)) {
				monaco.languages.register({
					id: JSONNET_LANGUAGE_ID,
					extensions: [".jsonnet", ".libsonnet"],
					aliases: ["Jsonnet", "jsonnet"],
				});
				monaco.languages.setLanguageConfiguration(
					JSONNET_LANGUAGE_ID,
					jsonnetLanguageConfiguration,
				);
				monaco.languages.setMonarchTokensProvider(
					JSONNET_LANGUAGE_ID,
					jsonnetMonarchLanguage,
				);
			}

			// Bind the diagnostics module to this Monaco instance so future
			// lspDiagnostics pushes can locate models. Idempotent — only the
			// first call captures the namespace, but it stays valid across
			// editor remounts.
			//
			// (Note: TS/JS bundled provider configuration happens at module load
			// via loader.init() above — doing it here is too late for Monaco
			// 0.55.x to retract already-registered providers.)
			bindMonacoForDiagnostics(monaco);
		}
		const currentTheme = useStore.getState().config?.theme ?? "dark";
		monaco.editor.setTheme(
			currentTheme === "light" ? TEMPEST_LIGHT_THEME_NAME : TEMPEST_THEME_NAME,
		);

		// Jump to line if specified. Defer one frame so Monaco has done its
		// initial layout pass — otherwise revealLineInCenter centers against a
		// stale viewport height and the target line lands off-screen or at top.
		if (lineNumber) {
			const target = lineNumber;
			editor.setPosition({ lineNumber: target, column: 1 });
			requestAnimationFrame(() => {
				editor.revealLineInCenter(target);
			});
		}

		// Also bind Cmd+S inside Monaco's own keybinding system
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
			handleSaveRef.current(),
		);

		// Register import link provider for TS/JS files.
		// registerLinkProvider returns an IDisposable; if we don't dispose it on
		// unmount, every editor mount leaks two global providers that fire for all
		// future editors. Track them in disposablesRef and clean up on unmount.
		const linkProvider = new ImportLinkProvider(filePath);
		disposablesRef.current.push(
			monaco.languages.registerLinkProvider(
				{ language: "typescript" },
				linkProvider,
			),
			monaco.languages.registerLinkProvider(
				{ language: "javascript" },
				linkProvider,
			),
		);

		// --- LSP wiring ---
		// We attach LSP only when this editor is opened from a workspace context;
		// free-standing files (no workspacePath) keep Monaco's built-in behaviour.
		const model = editor.getModel();
		if (model && workspacePath) {
			// Register provider context so the global hover/definition providers
			// can route this model's requests to the correct (workspace, language).
			lspContextDisposeRef.current = registerModelContext(
				model,
				workspacePath,
				language,
			);
			// Refcounted global hover/definition providers — only installed once.
			lspReleaseRef.current = acquireLspProviders(monaco);
			// Apply any diagnostics that arrived before this model existed.
			flushDiagnosticsFor(monaco, model);
			// Bridge the model's content + lifecycle to the language server.
			// The bridge reads the URI directly from the model so it matches
			// what our hover/definition providers will send.
			lspBridgeRef.current = attachLsp({
				model,
				workspacePath,
				languageId: language,
			});
		}

		// Handle Cmd+click on import specifiers: resolve the module and open it.
		// Monaco's standalone opener ignores custom URI schemes, so we handle
		// clicks directly via onMouseDown instead.
		editor.onMouseDown((e) => {
			if (!e.event.metaKey) return;
			const pos = e.target.position;
			if (!pos) return;

			const model = editor.getModel();
			if (!model) return;

			const lineContent = model.getLineContent(pos.lineNumber);

			// Check if the click is inside an import specifier string
			const patterns = [
				/from\s+(["'])([^"']+)\1/g,
				/require\(\s*(["'])([^"']+)\1\s*\)/g,
				/import\(\s*(["'])([^"']+)\1\s*\)/g,
			];

			for (const pattern of patterns) {
				const regex = new RegExp(pattern.source, pattern.flags);
				let match;
				while ((match = regex.exec(lineContent)) !== null) {
					const specifier = match[2];
					if (!specifier) continue;
					const quoteChar = match[1];
					const specStart = lineContent.indexOf(
						quoteChar + specifier + quoteChar,
						match.index,
					);
					if (specStart === -1) continue;
					const colStart = specStart + 2; // 1-based + opening quote
					const colEnd = colStart + specifier.length;
					if (pos.column >= colStart && pos.column <= colEnd) {
						// Click is inside this specifier — resolve and open
						api.resolveModulePath(specifier, filePath).then((r: any) => {
							if (!r.resolvedPath) return;
							const label = r.resolvedPath.split("/").pop() ?? "Editor";
							const config = useStore.getState().config;
							const isMonaco = config?.editor === "monaco";
							const { focusedPaneId } = useStore.getState();
							if (focusedPaneId) {
								const tab = createTab(PaneTabKind.Editor, label, {
									...(isMonaco ? {} : { terminalId: crypto.randomUUID() }),
									editorFilePath: r.resolvedPath,
								});
								addTab(focusedPaneId, tab);
							}
						});
						return;
					}
				}
			}
		});

		// --- EditorConfig: pull tabSize/insertSpaces from the project's
		//     .editorconfig (if any) and apply to this model. The save
		//     pipeline will read trim/insertFinalNewline from the same
		//     resolution at save time. We do this fire-and-forget; if the
		//     fetch fails for any reason, Monaco's defaults stand.
		(async () => {
			try {
				const ec = await api.getEditorconfig({ filePath, workspacePath });
				const m = editor.getModel();
				if (!m) return;
				const opts: { tabSize?: number; insertSpaces?: boolean } = {};
				if (ec.indentStyle === "tab") opts.insertSpaces = false;
				else if (ec.indentStyle === "space") opts.insertSpaces = true;
				const size = ec.indentSize ?? ec.tabWidth;
				if (typeof size === "number" && size > 0) opts.tabSize = size;
				if (Object.keys(opts).length > 0) m.updateOptions(opts);
			} catch (err) {
				console.warn("[MonacoEditor] editorconfig fetch failed:", err);
			}
		})();

		// --- Format-on-paste: when enabled in config, send the inserted
		//     range through formatBuffer and apply the resulting edits. We
		//     restrict to the pasted range so we don't reformat the whole
		//     file just because the user dropped in a snippet.
		editor.onDidPaste(
			(e: {
				range: {
					startLineNumber: number;
					startColumn: number;
					endLineNumber: number;
					endColumn: number;
				};
			}) => {
				// Resolve the user's config lazily inside the handler — it's
				// cheap enough and avoids stale-config issues if the user toggles
				// formatOnPaste while a file is open.
				void (async () => {
					try {
						const cfg = await api.resolveSaveConfig({
							workspacePath,
							languageId: language,
							filePath,
						});
						if (!cfg.formatOnPaste) return;
						const m = editor.getModel();
						if (!m) return;
						const opts = m.getOptions();
						const r = await api.formatBuffer({
							filePath,
							workspacePath,
							languageId: language,
							content: m.getValue(),
							options: {
								tabSize: opts.tabSize,
								insertSpaces: opts.insertSpaces,
							},
							range: {
								start: {
									line: e.range.startLineNumber - 1,
									character: e.range.startColumn - 1,
								},
								end: {
									line: e.range.endLineNumber - 1,
									character: e.range.endColumn - 1,
								},
							},
						});
						const result = r.result;
						if (result.kind === "edits" && result.edits.length > 0) {
							m.pushEditOperations(
								null,
								result.edits.map((edit: LspTextEdit) => ({
									range: {
										startLineNumber: edit.range.start.line + 1,
										startColumn: edit.range.start.character + 1,
										endLineNumber: edit.range.end.line + 1,
										endColumn: edit.range.end.character + 1,
									},
									text: edit.newText,
								})),
								() => null,
							);
						} else if (result.kind === "fullText") {
							// Format-on-paste must never replace the whole buffer. A
							// fullText result here means the chosen provider only knows
							// document formatting, so leave the paste as-is.
							console.warn(
								"[MonacoEditor] ignoring full-document formatter result for paste",
							);
						}
					} catch (err) {
						console.warn("[MonacoEditor] format on paste failed:", err);
					}
				})();
			},
		);

		editor.focus();
	};

	const handleEditorChange = (value: string | undefined) => {
		if (value !== undefined) {
			currentContentRef.current = value;
			setIsDirty(value !== lastSavedContentRef.current);
		}
	};

	if (error) {
		return (
			<div
				className="flex flex-col items-center justify-center h-full gap-2"
				style={{ color: "var(--ctp-red)" }}
			>
				<span className="text-sm">Failed to open file</span>
				<span
					className="text-xs max-w-md text-center"
					style={{ color: "var(--ctp-subtext0)" }}
				>
					{error}
				</span>
			</div>
		);
	}

	if (content === null) {
		return (
			<div
				className="flex items-center justify-center h-full"
				style={{ color: "var(--ctp-subtext0)" }}
			>
				<span className="text-sm">Loading file...</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full w-full">
			{/* Header bar */}
			<div
				className="flex items-center h-8 px-3 text-xs shrink-0 gap-2"
				style={{
					backgroundColor: "var(--ctp-mantle)",
					borderBottom: "1px solid var(--ctp-surface0)",
					color: "var(--ctp-subtext1)",
				}}
			>
				<span className="truncate flex-1" title={filePath}>
					{headerPath}
					{isDirty && (
						<span
							className="ml-1.5 inline-block w-2 h-2 rounded-full"
							style={{ backgroundColor: "var(--ctp-peach)" }}
							title="Unsaved changes"
						/>
					)}
				</span>
				{isSaving && (
					<span style={{ color: "var(--ctp-overlay0)" }}>Saving...</span>
				)}
				{!isSaving && saveStatus && (
					<span
						className="text-[11px] truncate"
						style={{ color: "var(--ctp-overlay0)", maxWidth: 280 }}
						title={saveStatus}
					>
						{saveStatus}
					</span>
				)}
			</div>

			{/* Monaco editor.
          `path` is critical: without it, Monaco gives the model a synthetic
          URI like `inmemory://model/1` which doesn't match the `file://` URI
          we send in textDocument/didOpen, so the LSP server has no document
          at the URI our hover/definition providers query. We pass an
          explicit `file://` URI so model.uri.toString() equals the LSP URI. */}
			<div className="flex-1 min-h-0">
				<Editor
					path={`file://${filePath}`}
					defaultValue={content}
					language={language}
					theme={monacoThemeName}
					onChange={handleEditorChange}
					onMount={handleEditorMount}
					options={{
						fontSize: 13,
						fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
						minimap: { enabled: false },
						scrollBeyondLastLine: false,
						renderLineHighlight: "line",
						padding: { top: 8 },
						smoothScrolling: true,
						cursorBlinking: "smooth",
						automaticLayout: true,
					}}
				/>
			</div>

			{/* Vim status bar */}
			{vimEnabled && (
				<div
					ref={statusBarRef}
					className="h-6 px-3 text-xs font-mono flex items-center shrink-0"
					style={{
						backgroundColor: "var(--ctp-mantle)",
						borderTop: "1px solid var(--ctp-surface0)",
						color: "var(--ctp-subtext0)",
					}}
				/>
			)}
		</div>
	);
}
