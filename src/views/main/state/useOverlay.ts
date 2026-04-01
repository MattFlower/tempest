import { useEffect, type ReactNode } from "react";
import { useStore } from "./store";

/**
 * Signals that a full-screen overlay (dialog, palette, context menu) is mounted.
 * While any overlay is active, native webviews are hidden so they don't
 * render on top of HTML content.
 */
export function useOverlay() {
  const pushOverlay = useStore((s) => s.pushOverlay);
  const popOverlay = useStore((s) => s.popOverlay);

  useEffect(() => {
    pushOverlay();
    return () => popOverlay();
  }, [pushOverlay, popOverlay]);
}

/**
 * Wrapper for components that conditionally render overlays.
 * Calls useOverlay() on mount/unmount so it can be used inside
 * conditional rendering (where hooks can't be called directly).
 */
export function OverlayWrapper({ children }: { children: ReactNode }) {
  useOverlay();
  return children;
}
