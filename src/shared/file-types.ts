// ============================================================
// Shared file-type helpers used by both the bun backend and the
// webview frontend. Keep this file dependency-free.
// ============================================================

export const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

export function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext !== undefined && ext in IMAGE_EXTENSION_TO_MIME;
}

export function mimeForImagePath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return (ext && IMAGE_EXTENSION_TO_MIME[ext]) || "application/octet-stream";
}
