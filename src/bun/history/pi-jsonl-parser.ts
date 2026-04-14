// ============================================================
// Pi JSONL Parser — parses Pi coding-agent session transcripts.
//
// Pi's JSONL format differs from Claude's:
//   - Envelope `type` values: "session", "message", "model_change",
//     "thinking_level_change", "custom", "label", etc.
//   - Only `type:"message"` records carry conversation content.
//   - `message.role` is one of "user" | "assistant" | "toolResult".
//   - Assistant content blocks: `{type:"text"}`, `{type:"thinking"}`,
//     `{type:"toolCall", name, arguments}`.
//   - Tool names are lowercase (`bash`, `read`, `edit`, `write`).
//
// This parser normalizes into the same `ParsedMessage` shape used by
// the Claude parser so UI components and the metadata cache can stay
// provider-agnostic. Tool names are Title-Cased on the way out so that
// downstream filters (e.g. AIContextProvider) recognize them.
// ============================================================

import type { ParsedMessage, ToolCallInfo } from "./jsonl-parser";

export type { ParsedMessage, ToolCallInfo };

type ParseResult =
  | { kind: "message"; message: ParsedMessage }
  | { kind: "header"; cwd?: string; timestamp?: string; id?: string }
  | { kind: "skipped" };

/**
 * Pi session header record. Always the first line of a Pi session file.
 * Carries the authoritative `cwd` — prefer this over deriving a workspace
 * from the encoded directory name.
 */
export interface PiSessionHeader {
  cwd?: string;
  timestamp?: string;
  id?: string;
}

/**
 * Parse a single line of a Pi JSONL session file.
 * Returns the session header, a normalized message, or "skipped".
 */
export function parseLine(line: string): ParseResult {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "skipped" };

  let obj: Record<string, any>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "skipped" };
  }

  if (typeof obj !== "object" || obj === null) return { kind: "skipped" };

  const envelopeType = obj.type;
  if (typeof envelopeType !== "string") return { kind: "skipped" };

  if (envelopeType === "session") {
    return {
      kind: "header",
      cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
      timestamp:
        typeof obj.timestamp === "string" ? obj.timestamp : undefined,
      id: typeof obj.id === "string" ? obj.id : undefined,
    };
  }

  if (envelopeType !== "message") return { kind: "skipped" };

  const envelopeTimestamp =
    typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const envelopeUuid = typeof obj.id === "string" ? obj.id : undefined;

  const inner = obj.message;
  if (typeof inner !== "object" || inner === null) return { kind: "skipped" };

  const role = inner.role;
  if (typeof role !== "string") return { kind: "skipped" };

  // Pi emits tool results as standalone messages with role "toolResult".
  // Skip them: the preceding assistant message already carries the
  // triggering tool call, and Pi rehydrates results from its own cache
  // when resuming. Showing them would clutter the transcript.
  if (role === "toolResult") return { kind: "skipped" };

  if (role !== "user" && role !== "assistant") return { kind: "skipped" };

  const { textContent, toolCalls } = extractContent(inner);
  const searchableText = buildSearchableText(textContent, toolCalls);

  return {
    kind: "message",
    message: {
      type: role,
      uuid: envelopeUuid,
      timestamp: envelopeTimestamp,
      sessionId: undefined,
      gitBranch: undefined,
      textContent,
      toolCalls,
      searchableText,
    },
  };
}

/** Parse an entire Pi JSONL file into ordered ParsedMessages. */
export async function parseFile(filePath: string): Promise<ParsedMessage[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");
  const parsed: ParsedMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const result = parseLine(trimmed);
    if (result.kind === "message") {
      parsed.push(result.message);
    }
  }

  return parsed;
}

/**
 * Extract the `cwd` / `timestamp` / `id` from a Pi session header line.
 * Returns undefined if the line isn't a header record.
 */
export function parseSessionHeader(line: string): PiSessionHeader | undefined {
  const result = parseLine(line);
  if (result.kind !== "header") return undefined;
  return { cwd: result.cwd, timestamp: result.timestamp, id: result.id };
}

/**
 * Extract a short summary for a Pi tool call. Mirrors the Claude
 * `extractToolSummary` but keyed on Pi's lowercase tool names and
 * Pi's argument keys (`path` instead of `file_path`, etc.).
 */
export function extractToolSummary(
  name: string,
  input: Record<string, any>,
): string {
  switch (name) {
    case "bash":
      if (typeof input.command === "string") return input.command;
      break;
    case "read":
    case "edit":
    case "write":
      if (typeof input.path === "string") return input.path;
      if (typeof input.file_path === "string") return input.file_path;
      break;
  }
  const keys = Object.keys(input).sort().join(" ");
  return `${name} ${keys}`;
}

/**
 * Normalize a Pi tool name to Claude's Title Case so downstream filters
 * (AIContextProvider, ToolCallBadge) recognize them consistently.
 */
export function normalizeToolName(name: string): string {
  switch (name) {
    case "bash":
      return "Bash";
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    default:
      if (name.length === 0) return name;
      return name[0]!.toUpperCase() + name.slice(1);
  }
}

// --- Private helpers ---

/**
 * JSON.stringify replacer that returns plain objects with their keys
 * sorted alphabetically. Sorting yields stable output across runs without
 * the property-filtering footgun of passing an array replacer.
 */
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}


function extractContent(inner: Record<string, any>): {
  textContent: string | undefined;
  toolCalls: ToolCallInfo[];
} {
  const content = inner.content;

  // Some user messages carry content as a plain string.
  if (typeof content === "string") {
    return { textContent: content, toolCalls: [] };
  }

  if (!Array.isArray(content)) {
    return { textContent: undefined, toolCalls: [] };
  }

  const textParts: string[] = [];
  const toolCalls: ToolCallInfo[] = [];

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const blockType = block.type;
    if (typeof blockType !== "string") continue;

    switch (blockType) {
      case "text": {
        if (typeof block.text === "string" && block.text) {
          textParts.push(block.text);
        }
        break;
      }
      case "toolCall": {
        const rawName =
          typeof block.name === "string" ? block.name : "unknown";
        const args: Record<string, any> =
          typeof block.arguments === "object" && block.arguments !== null
            ? block.arguments
            : {};
        const summary = extractToolSummary(rawName, args);
        let fullInput: string | undefined;
        try {
          // Note: passing an array as the JSON.stringify replacer applies
          // recursively as a property allowlist, which would strip nested
          // edit objects like `{oldText, newText}`. Use a function replacer
          // that sorts keys at every level instead.
          fullInput = JSON.stringify(args, sortKeysReplacer, 2);
        } catch {
          fullInput = undefined;
        }
        toolCalls.push({
          name: normalizeToolName(rawName),
          inputSummary: summary,
          fullInput,
          inputParamCount: Object.keys(args).length,
        });
        break;
      }
      // "thinking" blocks are dropped — encrypted reasoning, not useful
      // for display or search.
    }
  }

  const textContent = textParts.length > 0 ? textParts.join("\n") : undefined;
  return { textContent, toolCalls };
}

function buildSearchableText(
  textContent: string | undefined,
  toolCalls: ToolCallInfo[],
): string | undefined {
  const parts: string[] = [];
  if (textContent) parts.push(textContent);
  for (const call of toolCalls) {
    parts.push(call.name);
    if (call.inputSummary) parts.push(call.inputSummary);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
