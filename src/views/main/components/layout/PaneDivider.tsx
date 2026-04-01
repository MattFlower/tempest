import { useRef, useCallback, useEffect } from "react";
import { handleDividerDrag } from "../../state/actions";

interface PaneDividerProps {
  splitId: string;
  index: number;
  hidden: boolean;
}

export function PaneDivider({ splitId, index, hidden }: PaneDividerProps) {
  const startXRef = useRef(0);
  const containerWidthRef = useRef(0);
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

  // Safety: clean up on window blur or component unmount
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
      startXRef.current = e.clientX;
      // Walk up to the actual layout container (skip display:contents wrappers)
      let parent = (e.currentTarget as HTMLElement).parentElement;
      while (parent && parent.offsetWidth === 0) {
        parent = parent.parentElement;
      }
      containerWidthRef.current = parent?.getBoundingClientRect().width ?? 1;

      const move = (ev: MouseEvent) => {
        const deltaX = ev.clientX - startXRef.current;
        const deltaRatio = deltaX / containerWidthRef.current;
        if (deltaRatio !== 0) {
          handleDividerDrag(splitId, index, deltaRatio);
          startXRef.current = ev.clientX;
        }
      };
      const up = () => cleanup();

      listenersRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [splitId, index, cleanup],
  );

  if (hidden) return null;

  return (
    <div
      className="flex-shrink-0 cursor-col-resize select-none flex items-center justify-center"
      style={{ width: 6 }}
      onMouseDown={handleMouseDown}
    >
      <div className="h-full w-px bg-[var(--ctp-surface1)] hover:bg-[var(--ctp-blue)] transition-colors" />
    </div>
  );
}
