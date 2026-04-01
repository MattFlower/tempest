// Build script: creates a self-contained monaco-vim bundle that uses window.monaco
// Run: bun run src/vendor/build-monaco-vim.ts

import { build } from "bun";

// Create shim files that re-export from window.monaco
const editorApiShim = `
const m = (window as any).monaco;
export const KeyCode = m.KeyCode;
export const Position = m.Position;
export const Range = m.Range;
export const Selection = m.Selection;
export const SelectionDirection = m.SelectionDirection;
export const editor = m.editor;
`;

const shiftCommandShim = `
const m = (window as any).monaco;
// ShiftCommand is not on the public API — provide a no-op fallback
export const ShiftCommand = m.editor?.ShiftCommand ?? class ShiftCommand {
  constructor(public range: any, public opts: any) {}
  getEditOperations() { return []; }
  computeCursorState() { return null; }
};
`;

// Write shims to temp files
await Bun.write("/tmp/monaco-editor-api-shim.ts", editorApiShim);
await Bun.write("/tmp/monaco-editor-shift-shim.ts", shiftCommandShim);

const result = await build({
  entrypoints: [
    require.resolve("monaco-vim"),
  ],
  target: "browser",
  format: "esm",
  minify: true,
  plugins: [
    {
      name: "monaco-shim",
      setup(build) {
        build.onResolve({ filter: /monaco-editor\/esm\/vs\/editor\/editor\.api$/ }, () => ({
          path: "/tmp/monaco-editor-api-shim.ts",
        }));
        build.onResolve({ filter: /monaco-editor\/esm\/vs\/editor\/common\/commands\/shiftCommand$/ }, () => ({
          path: "/tmp/monaco-editor-shift-shim.ts",
        }));
      },
    },
  ],
  outdir: "src/vendor",
  naming: "monaco-vim.bundle.js",
});

if (result.success) {
  console.log("Built monaco-vim.bundle.js successfully");
} else {
  console.error("Build failed:", result.logs);
  process.exit(1);
}
