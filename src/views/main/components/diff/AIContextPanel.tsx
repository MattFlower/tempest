// ============================================================
// AIContextPanel — Port of AIContextPanelView.swift
// Shows Claude's edit history for the selected file: message
// bubbles, tool call waypoints with timeline navigation.
// ============================================================

import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import type {
  FileAIContext,
  FileChangeTimeline,
  FileChangeEvent,
  SessionMessage,
  ToolCallInfo,
} from "../../../../shared/ipc-types";
import { renderInlineMarkdown } from "../inline-markdown";

interface AIContextPanelProps {
  context: FileAIContext | null;
  timeline: FileChangeTimeline | null;
  currentChangeIndex: number;
  onChangeIndex: (index: number) => void;
}

export function AIContextPanel({
  context,
  timeline,
  currentChangeIndex,
  onChangeIndex,
}: AIContextPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const allFileChangeEvents = useMemo(() => {
    if (!context) return [];
    return context.sessions.flatMap((s) => s.fileChanges);
  }, [context]);

  const isCurrentWaypoint = useCallback(
    (event: FileChangeEvent) => {
      if (currentChangeIndex < 0 || currentChangeIndex >= allFileChangeEvents.length) return false;
      return allFileChangeEvents[currentChangeIndex]?.id === event.id;
    },
    [allFileChangeEvents, currentChangeIndex],
  );

  // Auto-scroll to current waypoint
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector(
      `[data-waypoint-index="${currentChangeIndex}"]`,
    );
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    }
  }, [currentChangeIndex, context?.filePath]);

  const canGoBack = currentChangeIndex > 0;
  const canGoForward = timeline != null && currentChangeIndex < timeline.changes.length - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{
          background: "var(--ctp-mantle)",
          borderBottom: "1px solid var(--ctp-surface0)",
        }}
      >
        <span className="font-semibold text-sm" style={{ color: "var(--ctp-mauve)" }}>
          AI Context
        </span>

        {context && context.sessions.length > 0 && (
          <span
            className="text-sm truncate"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {context.sessions[0]!.sessionSummary}
          </span>
        )}

        <span className="flex-1" />

        {timeline && timeline.changes.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--ctp-mauve)" }}>
              Change {currentChangeIndex + 1} of {timeline.changes.length}
            </span>
            <button
              className="px-2 py-0.5 text-sm rounded"
              style={{
                background: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                opacity: canGoBack ? 1 : 0.4,
              }}
              disabled={!canGoBack}
              onClick={() => onChangeIndex(currentChangeIndex - 1)}
            >
              Prev
            </button>
            <button
              className="px-2 py-0.5 text-sm rounded"
              style={{
                background: "var(--ctp-surface0)",
                color: "var(--ctp-text)",
                opacity: canGoForward ? 1 : 0.4,
              }}
              disabled={!canGoForward}
              onClick={() => onChangeIndex(currentChangeIndex + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {context ? (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto px-3 py-1.5">
          <div className="flex flex-col gap-0.5">
            {context.sessions.map((session) =>
              session.messages.map((msg, msgIdx) => {
                const eventsForMessage = session.fileChanges.filter(
                  (e) => e.messageIndex === msgIdx,
                );
                return (
                  <div key={`${session.id}-${msgIdx}`}>
                    {msg.text && (
                      <MessageBubble message={msg} />
                    )}
                    {eventsForMessage.map((event) => {
                      // Find global index for this event
                      let globalIdx = 0;
                      outer: for (const s of context.sessions) {
                        for (const e of s.fileChanges) {
                          if (e.id === event.id) break outer;
                          globalIdx++;
                        }
                      }
                      // Find matching ToolCallInfo from the message
                      const matchingToolCall = msg.toolCalls?.find(
                        (tc) => tc.tool === event.toolName && tc.summary === event.inputSummary,
                      );
                      return (
                        <ToolCallWaypoint
                          key={event.id}
                          event={event}
                          isCurrent={isCurrentWaypoint(event)}
                          globalIndex={globalIdx}
                          toolCall={matchingToolCall}
                        />
                      );
                    })}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-1"
          style={{ color: "var(--ctp-subtext0)" }}
        >
          <span className="text-base">No AI context for this file</span>
          <span className="text-sm opacity-60">
            This file was not modified by Claude
          </span>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.type === "user";
  const text = message.text ?? "";
  const parsed = parseCommand(text);
  const [isExpanded, setIsExpanded] = useState(false);

  const strippedText = parsed ? null : stripTags(text);
  const isLongText = strippedText != null && (strippedText.length > 200 || (strippedText.match(/\n/g)?.length ?? 0) > 2);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span
          className="text-xs font-medium"
          style={{ color: isUser ? "var(--ctp-teal)" : "var(--ctp-blue)" }}
        >
          {isUser ? "You" : "Claude"}
        </span>
        {message.timestamp && (
          <span className="text-xs" style={{ color: "var(--ctp-subtext0)" }}>
            {formatTimestamp(message.timestamp)}
          </span>
        )}
      </div>
      <div
        className="px-2 py-1.5 rounded text-sm"
        style={{
          background: isUser ? "rgba(148, 226, 213, 0.1)" : "transparent",
          border: isUser ? "1px solid rgba(148, 226, 213, 0.3)" : "none",
          color: "var(--ctp-text)",
        }}
      >
        {parsed ? (
          <div className="flex flex-col gap-1">
            <span className="font-semibold font-mono" style={{ color: "var(--ctp-teal)" }}>
              /{parsed.name}
            </span>
            {parsed.args && (
              <span className="text-sm">
                {truncate(parsed.args, 250)}
              </span>
            )}
          </div>
        ) : (
          <div>
            <div
              style={
                !isExpanded && isLongText
                  ? {
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }
                  : undefined
              }
            >
              {renderInlineMarkdown(strippedText!)}
            </div>
            {isLongText && (
              <button
                className="text-xs mt-1 cursor-pointer"
                style={{ color: "var(--ctp-blue)" }}
                onClick={() => setIsExpanded((p) => !p)}
              >
                {isExpanded ? "Show less \u25B4" : "Show more \u25BE"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Parse tool input JSON into key-value pairs for structured display */
function parsedParams(
  toolCall: ToolCallInfo | undefined,
): Array<{ key: string; value: string }> | null {
  if (!toolCall?.input) return null;
  try {
    const json = JSON.parse(toolCall.input);
    if (typeof json !== "object" || json === null) return null;
    const params: Array<{ key: string; value: string }> = [];
    for (const key of Object.keys(json).sort()) {
      const value = json[key];
      if (typeof value === "string") {
        params.push({ key, value });
      } else if (typeof value === "number" || typeof value === "boolean") {
        params.push({ key, value: String(value) });
      } else {
        try {
          params.push({ key, value: JSON.stringify(value, null, 2) });
        } catch {
          params.push({ key, value: String(value) });
        }
      }
    }
    return params.length > 0 ? params : null;
  } catch {
    return null;
  }
}

function ToolCallWaypoint({
  event,
  isCurrent,
  globalIndex,
  toolCall,
}: {
  event: FileChangeEvent;
  isCurrent: boolean;
  globalIndex: number;
  toolCall?: ToolCallInfo;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const params = useMemo(() => parsedParams(toolCall), [toolCall]);
  const hasDetail = params != null || toolCall?.input != null;

  return (
    <div
      data-waypoint-index={globalIndex}
      className="rounded text-sm"
      style={{
        background: isCurrent
          ? "rgba(203, 166, 247, 0.15)"
          : "rgba(203, 166, 247, 0.05)",
        border: `1px solid ${isCurrent ? "var(--ctp-mauve)" : "rgba(203, 166, 247, 0.2)"}`,
      }}
    >
      {/* Header row — clickable to expand when detail available */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5${hasDetail ? " cursor-pointer hover:bg-white/5" : ""}`}
        onClick={hasDetail ? () => setIsExpanded((p) => !p) : undefined}
      >
        {hasDetail && (
          <span
            className="text-[10px] font-mono"
            style={{ color: "var(--ctp-overlay0)" }}
          >
            {isExpanded ? "\u25BC" : "\u25B6"}
          </span>
        )}
        <span style={{ color: "var(--ctp-mauve)" }}>&#x270E;</span>
        <span className="font-semibold" style={{ color: "var(--ctp-mauve)" }}>
          {event.toolName}
        </span>
        <span
          className="truncate flex-1"
          style={{ color: "var(--ctp-text)" }}
        >
          {event.inputSummary}
        </span>
        {event.timestamp && (
          <span className="text-xs flex-shrink-0" style={{ color: "var(--ctp-subtext0)" }}>
            {formatTimestamp(event.timestamp)}
          </span>
        )}
        {isCurrent && (
          <span
            className="px-1.5 py-0.5 text-xs font-bold rounded-full flex-shrink-0"
            style={{
              background: "var(--ctp-mauve)",
              color: "var(--ctp-base)",
            }}
          >
            CURRENT
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="pb-2">
          {params && params.length > 0 ? (
            <div
              className="mx-2 p-2 rounded space-y-1"
              style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
            >
              {params.map((param) => (
                <div key={param.key}>
                  <div
                    className="text-[10px] font-semibold"
                    style={{ color: "var(--ctp-overlay0)" }}
                  >
                    {param.key}
                  </div>
                  <div
                    className="text-xs font-mono break-all select-text"
                    style={{
                      color: "var(--ctp-text)",
                      ...(param.value.length > 200
                        ? {
                            display: "-webkit-box",
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: "vertical" as const,
                            overflow: "hidden",
                          }
                        : {}),
                    }}
                  >
                    {param.value}
                  </div>
                </div>
              ))}
            </div>
          ) : toolCall?.input ? (
            <div
              className="mx-2 p-2 text-xs font-mono break-all rounded select-text"
              style={{
                color: "var(--ctp-text)",
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              {toolCall.input}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function parseCommand(text: string): { name: string; args: string } | null {
  const nameMatch = text.match(/<command-name>\s*\/?([^<]+?)\s*<\/command-name>/);
  if (!nameMatch) return null;
  const name = nameMatch[1]!;
  const argsMatch = text.match(/<command-args>\s*([\s\S]*?)\s*<\/command-args>/);
  const args = argsMatch ? argsMatch[1]! : "";
  return { name, args };
}

function stripTags(text: string): string {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]+>/g, "");
  } while (result !== previous);
  return result.trim();
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + "..." : text;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} ${time}`;
}
