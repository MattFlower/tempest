// ============================================================
// ImageViewerPane — Renders an image file in a pane.
// Reads bytes via readImageFile RPC and displays as a data URL,
// fitted to the pane with native aspect ratio preserved.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { api } from "../../state/rpc-client";

interface ImageViewerPaneProps {
  filePath?: string;
}

interface LoadedImage {
  src: string;
  fileName: string;
  byteSize: number;
  naturalWidth: number;
  naturalHeight: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageViewerPane({ filePath }: ImageViewerPaneProps) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFitted, setIsFitted] = useState(true);

  const loadImage = useCallback(async () => {
    if (!filePath) return;
    setError(null);
    try {
      const result = await api.readImageFile(filePath);
      const src = `data:${result.mime};base64,${result.base64}`;
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
        probe.onerror = () => reject(new Error("Image data could not be decoded"));
        probe.src = src;
      });
      setImage({
        src,
        fileName: result.fileName,
        byteSize: result.byteSize,
        naturalWidth: dims.w,
        naturalHeight: dims.h,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setImage(null);
    }
  }, [filePath]);

  useEffect(() => {
    loadImage();
  }, [loadImage]);

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--ctp-subtext0)" }}>
        <span className="text-sm">No image selected</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex h-8 items-center px-3 text-xs shrink-0 gap-2"
        style={{
          backgroundColor: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
          color: "var(--ctp-subtext1)",
        }}
      >
        <span className="truncate" title={filePath}>
          {image?.fileName ?? filePath.split("/").pop()}
        </span>
        {image && (
          <span className="opacity-60">
            {image.naturalWidth} x {image.naturalHeight} - {formatBytes(image.byteSize)}
          </span>
        )}
        <button
          className="ml-auto px-2 py-0.5 rounded text-xs hover:brightness-125"
          style={{ backgroundColor: "var(--ctp-surface0)", color: "var(--ctp-subtext1)" }}
          onClick={() => setIsFitted((v) => !v)}
          title={isFitted ? "Show at actual size" : "Fit to pane"}
        >
          {isFitted ? "1:1" : "Fit"}
        </button>
        <button
          className="px-2 py-0.5 rounded text-xs hover:brightness-125"
          style={{ backgroundColor: "var(--ctp-surface0)", color: "var(--ctp-subtext1)" }}
          onClick={loadImage}
          title="Reload"
        >
          ↻
        </button>
      </div>

      <div
        className="relative flex-1 overflow-auto"
        style={{
          backgroundColor: "var(--ctp-base)",
          backgroundImage:
            "linear-gradient(45deg, var(--ctp-surface0) 25%, transparent 25%, transparent 75%, var(--ctp-surface0) 75%)," +
            "linear-gradient(45deg, var(--ctp-surface0) 25%, transparent 25%, transparent 75%, var(--ctp-surface0) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
      >
        {error && (
          <div
            className="flex h-full flex-col items-center justify-center gap-2"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            <span className="text-sm font-medium">Cannot Open Image</span>
            <span className="text-xs opacity-60">{error}</span>
          </div>
        )}
        {!error && !image && (
          <div className="flex h-full items-center justify-center" style={{ color: "var(--ctp-subtext0)" }}>
            <span className="text-sm">Loading...</span>
          </div>
        )}
        {!error && image && (
          <div className={isFitted ? "flex h-full w-full items-center justify-center p-2" : "p-2"}>
            <img
              src={image.src}
              alt={image.fileName}
              className={isFitted ? "max-h-full max-w-full object-contain" : "block"}
              draggable={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
