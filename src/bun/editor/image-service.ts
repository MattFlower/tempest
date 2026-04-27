// ============================================================
// Image service — reads image files from disk and returns them
// as base64-encoded data for display in an ImageViewer pane.
// ============================================================

import { mimeForImagePath } from "../../shared/file-types";

export interface ReadImageFileResult {
  base64: string;
  mime: string;
  fileName: string;
  byteSize: number;
}

export async function readImageFile(filePath: string): Promise<ReadImageFileResult> {
  const fileName = filePath.split("/").pop() ?? "";
  const mime = mimeForImagePath(filePath);
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  return { base64, mime, fileName, byteSize: bytes.byteLength };
}
