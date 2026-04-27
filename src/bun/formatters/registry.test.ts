// Resolution-order tests for the FormatterRegistry. We stub the
// individual provider modules' file-system / PATH probes via writing
// real fixtures into a tmpdir, then assert which provider wins for a
// given (filePath, languageId, workspacePath).
//
// We don't exercise the actual CLI processes — those would require
// gofmt/prettier/etc. on the test runner. Instead we cover:
//   1. Project-config-gated wins over LSP for matching languages.
//   2. Language-gated wins for canonical languages even with no config.
//   3. No-formatter case returns the right error.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FormatterRegistry } from "./registry";
import type { FormatContext } from "./provider";
import type { LspRpc } from "../lsp/lsp-rpc";

// Stub LspRpc — none of these tests actually invoke a server.
const stubRpc = {
  formatting: async () => ({ edits: [] }),
  rangeFormatting: async () => ({ edits: [] }),
} as unknown as LspRpc;

// Helper: build a minimal `node_modules/.bin/prettier` shim so the
// project-binary lookup succeeds (we need the *applies* check; we don't
// invoke it in these tests).
function makePrettierShim(workspacePath: string): void {
  const binDir = join(workspacePath, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "prettier");
  writeFileSync(shim, "#!/bin/sh\nexit 0\n");
  chmodSync(shim, 0o755);
}

describe("FormatterRegistry resolution order", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "tempest-fmt-"));
  });
  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("picks Prettier for a TS file in a project with .prettierrc and a project-local prettier binary", async () => {
    const ws = join(tmpRoot, "ts-with-prettier");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, ".prettierrc"), "{}");
    makePrettierShim(ws);

    const reg = new FormatterRegistry({
      rpc: stubRpc,
      hasFormattingCapability: () => false,
    });
    const ctx: FormatContext = {
      filePath: join(ws, "src/foo.ts"),
      workspacePath: ws,
      languageId: "typescript",
      content: "const x  =  1;\n",
      options: { tabSize: 2, insertSpaces: true },
    };
    const picked = await reg.pick(ctx);
    expect(picked?.id).toBe("prettier");
  });

  it("falls through to LSP for a TS file without project config when LSP advertises formatting", async () => {
    const ws = join(tmpRoot, "ts-no-prettier");
    mkdirSync(ws, { recursive: true });
    // No .prettierrc, no node_modules/.bin/prettier -> Prettier doesn't apply.

    const reg = new FormatterRegistry({
      rpc: stubRpc,
      hasFormattingCapability: () => true, // pretend the LSP advertises it
    });
    const ctx: FormatContext = {
      filePath: join(ws, "src/foo.ts"),
      workspacePath: ws,
      languageId: "typescript",
      content: "const x  =  1;\n",
      options: { tabSize: 2, insertSpaces: true },
    };
    const picked = await reg.pick(ctx);
    expect(picked?.id).toBe("lsp");
  });

  it("returns null for an unsupported language with no project config", async () => {
    const ws = join(tmpRoot, "unknown-lang");
    mkdirSync(ws, { recursive: true });

    const reg = new FormatterRegistry({
      rpc: stubRpc,
      hasFormattingCapability: () => false,
    });
    const ctx: FormatContext = {
      filePath: join(ws, "thing.swift"),
      workspacePath: ws,
      languageId: "swift",
      content: "",
      options: { tabSize: 4, insertSpaces: true },
    };
    const picked = await reg.pick(ctx);
    expect(picked).toBeNull();
  });

  it("describeForLanguage returns every nominally-eligible provider for the language", async () => {
    const ws = join(tmpRoot, "describe-py");
    mkdirSync(ws, { recursive: true });

    const reg = new FormatterRegistry({
      rpc: stubRpc,
      hasFormattingCapability: () => false,
    });
    const ctx: FormatContext = {
      filePath: join(ws, "main.py"),
      workspacePath: ws,
      languageId: "python",
      content: "",
      options: { tabSize: 4, insertSpaces: true },
    };
    const described = await reg.describeForLanguage(ctx);
    const ids = described.map((d) => d.provider.id);
    // Both ruff and black are nominally eligible for Python; LSP also
    // matches because python is in LSP_SUPPORTED_LANGUAGES.
    expect(ids).toContain("ruff");
    expect(ids).toContain("black");
    expect(ids).toContain("lsp");
    // None of them currently apply (no pyproject.toml, no LSP cap).
    expect(described.every((d) => d.applies === false)).toBe(true);
  });
});
