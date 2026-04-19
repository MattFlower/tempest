import { useEffect, useRef, useState } from "react";
import { keystrokeFromEvent, formatKeystroke } from "../../keybindings/keystroke";

const AUTO_COMMIT_MS = 900;

interface Props {
  onCommit: (keystroke: string) => void;
  onCancel: () => void;
}

export function KeybindingRecorder({ onCommit, onCancel }: Props) {
  const [chords, setChords] = useState<string[]>([]);
  const chordsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const commit = (list: string[]) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (list.length === 0) return;
    onCommit(list.join(" "));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onCancel();
      return;
    }

    const stroke = keystrokeFromEvent(e.nativeEvent);
    if (!stroke) return; // modifier-only, keep listening

    const next = [...chordsRef.current, stroke];
    chordsRef.current = next;
    setChords(next);

    if (next.length >= 2) {
      // Two chords captured — commit immediately.
      commit(next);
      return;
    }

    // First chord captured — wait briefly for an optional second chord.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(chordsRef.current), AUTO_COMMIT_MS);
  };

  const display = chords.length === 0
    ? "Press a keybinding\u2026"
    : formatKeystroke(chords.join(" ")) + (chords.length === 1 ? "\u00A0\u2026" : "");

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={handleKey}
      className="px-2 py-1 rounded text-xs font-mono outline-none min-w-[120px] text-center"
      style={{
        backgroundColor: "var(--ctp-surface2)",
        color: "var(--ctp-text)",
        border: "1px dashed var(--ctp-blue)",
        letterSpacing: "0.15em",
      }}
    >
      {display}
    </div>
  );
}
