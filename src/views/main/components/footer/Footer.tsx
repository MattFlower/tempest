import { UsageItem } from "../usage/UsageItem";
import { LspItem } from "../editor/lsp/LspItem";

/**
 * Application footer — a horizontal status bar at the bottom of the main view.
 * Hosts multiple status items (LSP, token usage). New items go inside the same
 * flex row so they share the footer's vertical rhythm and divider styling.
 */
export function Footer() {
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: "var(--ctp-mantle)",
        borderTop: "1px solid var(--ctp-surface0)",
      }}
    >
      <LspItem />
      <UsageItem />
    </div>
  );
}
