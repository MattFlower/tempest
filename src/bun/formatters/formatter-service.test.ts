// Verifies that a forced provider that doesn't actually apply to the
// file produces a useful error rather than silently calling the
// provider and reporting a misleading noop.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../shared/ipc-types";
import type { LspRpc } from "../lsp/lsp-rpc";
import { FormatterService } from "./formatter-service";

const stubRpc = {
	formatting: async () => ({ edits: [] }),
	rangeFormatting: async () => ({ edits: [] }),
} as unknown as LspRpc;

describe("FormatterService — forced provider gating", () => {
	let tmpRoot: string;

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "tempest-fmt-svc-"));
	});
	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns a useful error when forced provider exists but doesn't apply (e.g. LSP without formatting capability)", async () => {
		const ws = join(tmpRoot, "py-no-format-cap");
		mkdirSync(ws, { recursive: true });

		const config: AppConfig = {
			workspaceRoot: tmpRoot,
			claudeArgs: [],
			formatting: {
				languages: { python: { defaultFormatter: "lsp" } },
			},
		};
		const svc = new FormatterService({
			rpc: stubRpc,
			hasFormattingCapability: () => false, // pyright doesn't advertise formatting
			anyRunningServerAdvertisesFormatting: () => "no",
			getConfig: () => config,
			getRepoSettingsFor: () => undefined,
		});

		const result = await svc.formatBuffer({
			filePath: join(ws, "main.py"),
			workspacePath: ws,
			languageId: "python",
			content: "i   = 2\n",
			options: { tabSize: 4, insertSpaces: true },
		});
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain("LSP");
			expect(result.message).toContain("python");
		}
	});

	it("listFormattersForLanguage drops LSP when servers run for this language but none format", async () => {
		const config: AppConfig = { workspaceRoot: tmpRoot, claudeArgs: [] };
		const svc = new FormatterService({
			rpc: stubRpc,
			hasFormattingCapability: () => false,
			anyRunningServerAdvertisesFormatting: () => "no",
			getConfig: () => config,
			getRepoSettingsFor: () => undefined,
		});
		const r = await svc.listFormattersForLanguage({ languageId: "python" });
		const ids = r.formatters.map((f) => f.id);
		expect(ids).not.toContain("lsp");
		// Other Python providers (Ruff, Black) still surface even though
		// they don't apply right now — the picker tells the user "this
		// language has these options if you set them up".
		expect(ids).toContain("ruff");
		expect(ids).toContain("black");
	});

	it("listFormattersForLanguage keeps LSP when no server is running yet (optimistic)", async () => {
		const config: AppConfig = { workspaceRoot: tmpRoot, claudeArgs: [] };
		const svc = new FormatterService({
			rpc: stubRpc,
			hasFormattingCapability: () => false,
			anyRunningServerAdvertisesFormatting: () => "unknown",
			getConfig: () => config,
			getRepoSettingsFor: () => undefined,
		});
		const r = await svc.listFormattersForLanguage({ languageId: "python" });
		expect(r.formatters.map((f) => f.id)).toContain("lsp");
	});

	it("does not fall back to whole-document formatting for range requests", async () => {
		const ws = join(tmpRoot, "ts-range-prettier");
		const binDir = join(ws, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		writeFileSync(join(ws, ".prettierrc"), "{}");
		const shim = join(binDir, "prettier");
		writeFileSync(shim, "#!/bin/sh\nprintf 'WHOLE DOCUMENT\n'\n");
		chmodSync(shim, 0o755);

		const config: AppConfig = { workspaceRoot: tmpRoot, claudeArgs: [] };
		const svc = new FormatterService({
			rpc: stubRpc,
			hasFormattingCapability: () => false,
			anyRunningServerAdvertisesFormatting: () => "unknown",
			getConfig: () => config,
			getRepoSettingsFor: () => undefined,
		});

		const result = await svc.formatBuffer({
			filePath: join(ws, "src/foo.ts"),
			workspacePath: ws,
			languageId: "typescript",
			content: "const x=1;\n",
			options: { tabSize: 2, insertSpaces: true },
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 10 },
			},
		});

		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain("range formatter");
		}
	});

	it("returns 'not registered' error when forced provider id is unknown", async () => {
		const config: AppConfig = {
			workspaceRoot: tmpRoot,
			claudeArgs: [],
			formatting: { defaultFormatter: "no-such-formatter" },
		};
		const svc = new FormatterService({
			rpc: stubRpc,
			hasFormattingCapability: () => false,
			anyRunningServerAdvertisesFormatting: () => "unknown",
			getConfig: () => config,
			getRepoSettingsFor: () => undefined,
		});
		const result = await svc.formatBuffer({
			filePath: "/tmp/x.ts",
			workspacePath: "/tmp",
			languageId: "typescript",
			content: "",
			options: { tabSize: 2, insertSpaces: true },
		});
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain("not registered");
		}
	});
});
