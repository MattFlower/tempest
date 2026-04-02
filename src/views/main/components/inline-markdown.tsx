import type { ReactNode } from "react";

/**
 * Render **bold** and `inline code` markdown as React elements.
 * Everything else passes through as plain text.
 */
export function renderInlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="font-mono px-1 py-0.5 rounded text-[0.85em]"
          style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
