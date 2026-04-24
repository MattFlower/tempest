// ============================================================
// Codex JSONL Parser — parses OpenAI Codex session rollouts.
//
// Codex writes one record per line under
// `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. The
// envelope shape we handle:
//
//   {"type":"session_meta","id":<uuid>,"timestamp":...,"cwd":...}
//   {"type":"response_item","item":{"type":"message","role":"user","content":[{...}]}}
//   {"type":"response_item","item":{"type":"message","role":"assistant","content":[...]}}
//   {"type":"response_item","item":{"type":"function_call","name":"shell","arguments":"{...}"}}
//   {"type":"response_item","item":{"type":"function_call_output",...}}
//   {"type":"response_item","item":{"type":"reasoning",...}}      <-- skipped
//   {"type":"event_msg",...}                                       <-- skipped
//
// We normalize into the shared `ParsedMessage` shape so the History
// Viewer and AIContextProvider stay provider-agnostic, and we Title-
// Case tool names (`shell` -> `Bash`, `read_file` -> `Read`,
// `apply_patch`/`write_file` -> `Edit`/`Write`) to match the names
// downstream filters key on.
// ============================================================

import type { ParsedMessage, ToolCallInfo } from "./jsonl-parser";

export type { ParsedMessage, ToolCallInfo };

type ParseResult =
  | { kind: "message"; message: ParsedMessage }
  | { kind: "header"; cwd?: string; timestamp?: string; id?: string }
  | { kind: "skipped" };

export interface CodexSessionHeader {
  cwd?: string;
  timestamp?: string;
  id?: string;
}

/**
 * Parse a single line of a Codex JSONL rollout file.
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

  if (envelopeType === "session_meta") {
    // Codex may also embed meta under a "payload" key; accept both layouts.
    const src = (obj.payload && typeof obj.payload === "object") ? obj.payload : obj;
    return {
      kind: "header",
      cwd: typeof src.cwd === "string" ? src.cwd : undefined,
      timestamp:
        typeof obj.timestamp === "string"
          ? obj.timestamp
          : typeof src.timestamp === "string"
            ? src.timestamp
            : undefined,
      id: typeof src.id === "string" ? src.id : undefined,
    };
  }

  if (envelopeType !== "response_item") return { kind: "skipped" };

  const envelopeTimestamp =
    typeof obj.timestamp === "string" ? obj.timestamp : undefined;

  const item = obj.item ?? obj.payload;
  if (typeof item !== "object" || item === null) return { kind: "skipped" };

  const itemType = item.type;
  if (typeof itemType !== "string") return { kind: "skipped" };

  // function_call => attach as a synthetic assistant message carrying a tool call
  if (itemType === "function_call") {
    const rawName = typeof item.name === "string" ? item.name : "unknown";
    const args = parseFunctionCallArguments(item.arguments);
    const summary = extractToolSummary(rawName, args);
    let fullInput: string | undefined;
    try {
      fullInput = JSON.stringify(args, sortKeysReplacer, 2);
    } catch {
      fullInput = undefined;
    }
    const toolCall: ToolCallInfo = {
      name: normalizeToolName(rawName),
      inputSummary: summary,
      fullInput,
      inputParamCount: Object.keys(args).length,
    };
    return {
      kind: "message",
      message: {
        type: "assistant",
        uuid: typeof item.id === "string" ? item.id : undefined,
        timestamp: envelopeTimestamp,
        sessionId: undefined,
        gitBranch: undefined,
        textContent: undefined,
        toolCalls: [toolCall],
        searchableText: buildSearchableText(undefined, [toolCall]),
      },
    };
  }

  if (itemType !== "message") return { kind: "skipped" };

  const role = item.role;
  if (role !== "user" && role !== "assistant") return { kind: "skipped" };

  const { textContent, toolCalls } = extractContent(item);
  const searchableText = buildSearchableText(textContent, toolCalls);

  return {
    kind: "message",
    message: {
      type: role,
      uuid: typeof item.id === "string" ? item.id : undefined,
      timestamp: envelopeTimestamp,
      sessionId: undefined,
      gitBranch: undefined,
      textContent,
      toolCalls,
      searchableText,
    },
  };
}

/** Parse an entire Codex JSONL file into ordered ParsedMessages. */
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

/** Extract the cwd / timestamp / id from a Codex session_meta line. */
export function parseSessionHeader(line: string): CodexSessionHeader | undefined {
  const result = parseLine(line);
  if (result.kind !== "header") return undefined;
  return { cwd: result.cwd, timestamp: result.timestamp, id: result.id };
}

/**
 * Extract a short summary for a Codex tool call. Keyed on Codex's
 * snake_case tool names and argument keys.
 */
export function extractToolSummary(
  name: string,
  input: Record<string, any>,
): string {
  switch (name) {
    case "shell":
      if (Array.isArray(input.command)) return input.command.join(" ");
      if (typeof input.command === "string") return input.command;
      break;
    case "read_file":
    case "view":
      if (typeof input.path === "string") return input.path;
      if (typeof input.file_path === "string") return input.file_path;
      break;
    case "write_file":
    case "apply_patch":
    case "edit":
      if (typeof input.path === "string") return input.path;
      if (typeof input.file_path === "string") return input.file_path;
      if (typeof input.input === "string") {
        // apply_patch usually receives a unified-diff blob; show a one-line hint
        const firstLine = input.input.split("\n").find((l: string) => l.trim());
        if (firstLine) return firstLine;
      }
      break;
  }
  const keys = Object.keys(input).sort().join(" ");
  return `${name} ${keys}`;
}

/**
 * Normalize a Codex tool name to Claude's Title Case so downstream
 * filters (AIContextProvider, ToolCallBadge) recognize them.
 */
export function normalizeToolName(name: string): string {
  switch (name) {
    case "shell":
      return "Bash";
    case "read_file":
    case "view":
      return "Read";
    case "write_file":
      return "Write";
    case "apply_patch":
    case "edit":
      return "Edit";
    default:
      if (name.length === 0) return name;
      return name[0]!.toUpperCase() + name.slice(1);
  }
}

// --- Private helpers ---

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

/** Codex encodes function-call arguments either as a JSON string or an object. */
function parseFunctionCallArguments(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      // Not JSON; leave empty so summary falls back to `name <keys>`.
    }
  }
  return {};
}

function extractContent(item: Record<string, any>): {
  textContent: string | undefined;
  toolCalls: ToolCallInfo[];
} {
  const content = item.content;

  if (typeof content === "string") {
    return { textContent: content, toolCalls: [] };
  }
  if (!Array.isArray(content)) {
    return { textContent: undefined, toolCalls: [] };
  }

  const textParts: string[] = [];

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const blockType = block.type;
    if (typeof blockType !== "string") continue;

    // Codex uses several shapes: {type:"input_text",text}, {type:"text",text},
    // {type:"output_text",text}. They all carry a `text` string.
    switch (blockType) {
      case "text":
      case "input_text":
      case "output_text": {
        if (typeof block.text === "string" && block.text) {
          textParts.push(block.text);
        }
        break;
      }
      // "reasoning" / "reasoning_summary" carry encrypted CoT — drop them.
    }
  }

  const textContent = textParts.length > 0 ? textParts.join("\n") : undefined;
  return { textContent, toolCalls: [] };
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
