import { useRef, useCallback } from "react";
import { handleDividerDrag } from "../../state/actions";

interface PaneDividerProps {
  splitId: string;
  index: number;
  hidden: boolean;
}

export function PaneDivider({ splitId, index, hidden }: PaneDividerProps) {
  const startXRef = useRef(0);
  const containerWidthRef = useRef(0);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      const deltaRatio = deltaX / containerWidthRef.current;
      if (deltaRatio !== 0) {
        handleDividerDrag(splitId, index, deltaRatio);
        startXRef.current = e.clientX;
      }
    },
    [splitId, index],
  );

  const onMouseUp = useCallback(() => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onMouseMove]);

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

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onMouseMove, onMouseUp],
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
