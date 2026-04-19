import { useCallback, useEffect, useRef } from "react";
import { setRunPaneHeight } from "../../state/run-pane-actions";
import { useStore, DEFAULT_RUN_PANE_HEIGHT } from "../../state/store";

interface RunPaneResizeHandleProps {
  workspacePath: string;
}

export function RunPaneResizeHandle({ workspacePath }: RunPaneResizeHandleProps) {
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const cleanup = useCallback(() => {
    if (listenersRef.current) {
      document.removeEventListener("mousemove", listenersRef.current.move);
      document.removeEventListener("mouseup", listenersRef.current.up);
      listenersRef.current = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("blur", cleanup);
    return () => {
      window.removeEventListener("blur", cleanup);
      cleanup();
    };
  }, [cleanup]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      startHeightRef.current =
        useStore.getState().runPaneHeight[workspacePath] ?? DEFAULT_RUN_PANE_HEIGHT;

      const move = (ev: MouseEvent) => {
        // Dragging up (negative delta) increases pane height.
        const delta = startYRef.current - ev.clientY;
        setRunPaneHeight(workspacePath, startHeightRef.current + delta);
      };
      const up = () => cleanup();
      listenersRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [workspacePath, cleanup],
  );

  return (
    <div
      className="flex-shrink-0 cursor-row-resize select-none"
      style={{ height: 4 }}
      onMouseDown={handleMouseDown}
    >
      <div className="h-px w-full bg-[var(--ctp-surface0)] hover:bg-[var(--ctp-blue)] transition-colors" />
    </div>
  );
}
