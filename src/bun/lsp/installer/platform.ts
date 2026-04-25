// ============================================================
// Platform detection for the GitHub-release installer.
//
// Tempest is macOS-only today. We expose a tight enum of supported
// platforms so recipes' `asset` map type-checks exhaustively, and we
// throw with a clear message on anything else — the GitHub-release
// installer can't usefully proceed without an asset.
// ============================================================

export type Platform = "darwin-arm64" | "darwin-x64";

export function detectPlatform(): Platform {
  if (process.platform !== "darwin") {
    throw new Error(
      `LSP github-release installer only supports macOS (detected ${process.platform}).`,
    );
  }
  // process.arch is "arm64" on Apple Silicon and "x64" on Intel.
  return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
}
