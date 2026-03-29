// ============================================================
// JSONL Parser — Port of JSONLParser.swift
// Parses Claude Code JSONL session files into structured messages.
// ============================================================

export interface ParsedMessage {
  type: string; // "user", "assistant", "system"
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  gitBranch?: string;
  textContent?: string;
  toolCalls: ToolCallInfo[];
  searchableText?: string;
}

export interface ToolCallInfo {
  name: string;
  inputSummary: string;
  fullInput?: string;
  inputParamCount: number;
}

type ParseResult =
  | { kind: "message"; message: ParsedMessage }
  | { kind: "skipped" };

// Noise record types to skip entirely
const SKIP_TYPES = new Set([
  "queue-operation",
  "progress",
  "file-history-snapshot",
]);

/**
 * Parse a single JSONL line into a ParseResult.
 * Returns { kind: "skipped" } for noise record types or empty lines.
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

  const type = obj.type;
  if (typeof type !== "string") return { kind: "skipped" };

  if (SKIP_TYPES.has(type)) return { kind: "skipped" };

  const uuid = typeof obj.uuid === "string" ? obj.uuid : undefined;
  const timestamp =
    typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const sessionId =
    typeof obj.sessionId === "string" ? obj.sessionId : undefined;
  const gitBranch =
    typeof obj.gitBranch === "string" ? obj.gitBranch : undefined;

  switch (type) {
    case "user": {
      const textContent = extractUserContent(obj);
      const toolCalls: ToolCallInfo[] = [];
      const searchableText = buildSearchableText(textContent, toolCalls);
      return {
        kind: "message",
        message: {
          type,
          uuid,
          timestamp,
          sessionId,
          gitBranch,
          textContent,
          toolCalls,
          searchableText,
        },
      };
    }

    case "assistant": {
      const { textContent, toolCalls } = extractAssistantContent(obj);
      const searchableText = buildSearchableText(textContent, toolCalls);
      return {
        kind: "message",
        message: {
          type,
          uuid,
          timestamp,
          sessionId,
          gitBranch,
          textContent,
          toolCalls,
          searchableText,
        },
      };
    }

    case "system": {
      const textContent =
        typeof obj.content === "string" ? obj.content : undefined;
      return {
        kind: "message",
        message: {
          type,
          uuid,
          timestamp,
          sessionId,
          gitBranch,
          textContent,
          toolCalls: [],
          searchableText: undefined,
        },
      };
    }

    default:
      return { kind: "skipped" };
  }
}

/**
 * Parse an entire JSONL file. Returns parsed messages.
 */
export async function parseFile(filePath: string): Promise<ParsedMessage[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");
  const parsed: ParsedMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const result = parseLine(trimmed);
      if (result.kind === "message") {
        parsed.push(result.message);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return parsed;
}

/**
 * Extract tool input summary for a named tool.
 */
export function extractToolSummary(
  name: string,
  input: Record<string, any>,
): string {
  switch (name) {
    case "Bash":
      if (typeof input.command === "string") return input.command;
      break;
    case "Read":
      if (typeof input.file_path === "string") return input.file_path;
      break;
    case "Grep":
      if (typeof input.pattern === "string") return input.pattern;
      break;
    case "Glob":
      if (typeof input.pattern === "string") return input.pattern;
      break;
    case "Edit":
    case "Write":
      if (typeof input.file_path === "string") return input.file_path;
      break;
    case "Skill":
      if (typeof input.skill === "string") return input.skill;
      break;
    case "Agent":
      if (typeof input.description === "string") return input.description;
      break;
    case "TaskCreate":
      if (typeof input.subject === "string") return input.subject;
      break;
    case "TaskUpdate":
      if (typeof input.taskId === "string") return input.taskId;
      break;
  }
  // Fallback: tool name + sorted input keys
  const keys = Object.keys(input).sort().join(" ");
  return `${name} ${keys}`;
}

// --- Private helpers ---

function extractUserContent(obj: Record<string, any>): string | undefined {
  const message = obj.message;
  if (typeof message !== "object" || message === null) return undefined;
  return typeof message.content === "string" ? message.content : undefined;
}

function extractAssistantContent(obj: Record<string, any>): {
  textContent: string | undefined;
  toolCalls: ToolCallInfo[];
} {
  const message = obj.message;
  if (typeof message !== "object" || message === null)
    return { textContent: undefined, toolCalls: [] };

  const contentBlocks = message.content;
  if (!Array.isArray(contentBlocks))
    return { textContent: undefined, toolCalls: [] };

  const textParts: string[] = [];
  const toolCalls: ToolCallInfo[] = [];

  for (const block of contentBlocks) {
    if (typeof block !== "object" || block === null) continue;
    const blockType = block.type;
    if (typeof blockType !== "string") continue;

    switch (blockType) {
      case "text":
        if (typeof block.text === "string" && block.text) {
          textParts.push(block.text);
        }
        break;
      case "tool_use": {
        const name =
          typeof block.name === "string" ? block.name : "Unknown";
        const inputRaw: Record<string, any> =
          typeof block.input === "object" && block.input !== null
            ? block.input
            : {};
        const summary = extractToolSummary(name, inputRaw);
        let fullInput: string | undefined;
        try {
          fullInput = JSON.stringify(inputRaw, Object.keys(inputRaw).sort(), 2);
        } catch {
          fullInput = undefined;
        }
        toolCalls.push({
          name,
          inputSummary: summary,
          fullInput,
          inputParamCount: Object.keys(inputRaw).length,
        });
        break;
      }
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
  if (textContent) {
    parts.push(textContent);
  }
  for (const call of toolCalls) {
    parts.push(call.name);
    if (call.inputSummary) {
      parts.push(call.inputSummary);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
