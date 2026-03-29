// ============================================================
// MessageStream — Port of MessageStreamView.swift
// Scrollable message list with user/assistant styling,
// collapsible tool call badges, and search highlighting.
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { SessionMessage, SessionSummary } from "../../../../shared/ipc-types";
import { ToolCallBadge, HIDDEN_TOOLS } from "./ToolCallBadge";

interface MessageStreamProps {
  messages: SessionMessage[];
  summary: SessionSummary;
  searchQuery?: string;
}

/** Strip HTML/XML tags from a string */
function stripTags(str: string): string {
  return str.replace(/<[^>]+>/g, "").trim();
}

/** Format ISO date string for display */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/** Format ISO date string as short date+time */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function MessageStream({ messages, summary, searchQuery }: MessageStreamProps) {
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter out empty messages and local commands
  const visibleMessages = useMemo(() => {
    return messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => {
        const hasText =
          msg.text != null && msg.text.trim().length > 0;
        const visibleToolCalls = (msg.toolCalls ?? []).filter(
          (tc) => !HIDDEN_TOOLS.has(tc.tool),
        );
        const hasVisibleToolCalls = visibleToolCalls.length > 0;

        if (!hasText && !hasVisibleToolCalls) return false;

        // Skip local command messages
        if (msg.text) {
          if (
            msg.text.includes("<local-command") ||
            msg.text.includes("<local-command-caveat>")
          ) {
            return false;
          }
        }
        return true;
      });
  }, [messages]);

  // Message indices that match the current search query
  const matchingIndices = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return visibleMessages
      .filter(({ msg }) => {
        const textMatch = msg.text?.toLowerCase().includes(query) ?? false;
        const toolMatch = (msg.toolCalls ?? []).some(
          (tc) =>
            tc.tool.toLowerCase().includes(query) ||
            tc.summary.toLowerCase().includes(query) ||
            (tc.input?.toLowerCase().includes(query) ?? false),
        );
        return textMatch || toolMatch;
      })
      .map(({ index }) => index);
  }, [visibleMessages, searchQuery]);

  // Scroll to match when match index changes
  useEffect(() => {
    if (matchingIndices.length === 0) return;
    const matchIdx = matchingIndices[currentMatchIndex];
    if (matchIdx == null) return;
    const el = document.getElementById(`msg-${matchIdx}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentMatchIndex, matchingIndices]);

  // Reset match index when matches change
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [matchingIndices.length]);

  const toggleExpand = useCallback((index: number) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const displayTitle = stripTags(summary.firstPrompt ?? "Untitled Session");

  return (
    <div className="flex flex-col h-full">
      {/* Match navigation bar */}
      {matchingIndices.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-1.5 shrink-0"
          style={{ backgroundColor: "rgba(249, 226, 175, 0.08)" }}
        >
          <span
            className="text-xs"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {Math.min(currentMatchIndex + 1, matchingIndices.length)} of{" "}
            {matchingIndices.length} matches
          </span>
          <span className="flex-1" />
          <button
            onClick={() =>
              setCurrentMatchIndex((i) => Math.max(0, i - 1))
            }
            disabled={currentMatchIndex === 0}
            className="text-xs font-semibold px-1 disabled:opacity-30 cursor-pointer"
            style={{ color: "var(--ctp-text)" }}
          >
            &#9650;
          </button>
          <button
            onClick={() =>
              setCurrentMatchIndex((i) =>
                Math.min(matchingIndices.length - 1, i + 1),
              )
            }
            disabled={currentMatchIndex >= matchingIndices.length - 1}
            className="text-xs font-semibold px-1 disabled:opacity-30 cursor-pointer"
            style={{ color: "var(--ctp-text)" }}
          >
            &#9660;
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="py-2">
          {/* Session header */}
          <div className="px-4 pt-1 pb-2">
            <div
              className="text-base font-semibold leading-tight"
              style={{ color: "var(--ctp-text)" }}
            >
              {displayTitle}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {(summary.modifiedAt ?? summary.createdAt) && (
                <span
                  className="text-xs"
                  style={{ color: "var(--ctp-subtext0)" }}
                >
                  {formatDate(
                    (summary.modifiedAt ?? summary.createdAt)!,
                  )}
                </span>
              )}
              {summary.gitBranch && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded"
                  style={{
                    color: "var(--ctp-text)",
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  {summary.gitBranch}
                </span>
              )}
            </div>
          </div>

          <div
            className="mx-4 my-2"
            style={{
              height: 1,
              backgroundColor: "var(--ctp-surface0)",
            }}
          />

          {/* Message list */}
          {visibleMessages.map(({ msg, index }) => {
            const isMatch = matchingIndices.includes(index);
            return (
              <div
                key={index}
                id={`msg-${index}`}
                className="px-4 py-2"
                style={
                  isMatch
                    ? { backgroundColor: "rgba(249, 226, 175, 0.1)" }
                    : undefined
                }
              >
                {msg.type === "user" ? (
                  <UserMessage
                    msg={msg}
                    index={index}
                  />
                ) : msg.type === "assistant" ? (
                  <AssistantMessage
                    msg={msg}
                    index={index}
                    isExpanded={expandedMessages.has(index)}
                    onToggleExpand={toggleExpand}
                  />
                ) : null}
              </div>
            );
          })}

          {visibleMessages.length === 0 && (
            <div
              className="flex items-center justify-center h-32 text-xs"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              No messages in this session
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- User Message ---

function UserMessage({
  msg,
  index,
}: {
  msg: SessionMessage;
  index: number;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {/* Person icon badge */}
      <div
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: "var(--ctp-blue)" }}
      >
        <span className="text-[11px] text-white">U</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            YOU
          </span>
          {msg.timestamp && (
            <span
              className="text-[11px]"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              {formatTime(msg.timestamp)}
            </span>
          )}
        </div>
        {msg.text && (
          <div
            className="text-[13px] mt-1 select-text whitespace-pre-wrap break-words"
            style={{ color: "var(--ctp-text)" }}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Assistant Message ---

function AssistantMessage({
  msg,
  index,
  isExpanded,
  onToggleExpand,
}: {
  msg: SessionMessage;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (index: number) => void;
}) {
  const isLongText =
    msg.text != null &&
    (msg.text.length > 200 || (msg.text.match(/\n/g) ?? []).length > 2);

  const visibleToolCalls = useMemo(
    () => (msg.toolCalls ?? []).filter((tc) => !HIDDEN_TOOLS.has(tc.tool)),
    [msg.toolCalls],
  );

  return (
    <div className="flex items-start gap-2.5">
      {/* Claude sparkle icon badge */}
      <div
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: "linear-gradient(135deg, var(--ctp-peach), rgba(250,179,135,0.8))",
        }}
      >
        <span className="text-[11px] text-white">{"\u2726"}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            CLAUDE
          </span>
          {msg.timestamp && (
            <span
              className="text-[11px]"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              {formatTime(msg.timestamp)}
            </span>
          )}
        </div>

        {msg.text && (
          <>
            <div
              className="text-[13px] mt-1 select-text whitespace-pre-wrap break-words"
              style={{
                color: "var(--ctp-text)",
                ...(!isExpanded && isLongText
                  ? {
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }
                  : {}),
              }}
            >
              {msg.text}
            </div>

            {isLongText && (
              <button
                onClick={() => onToggleExpand(index)}
                className="text-[11px] mt-0.5 cursor-pointer"
                style={{ color: "var(--ctp-blue)" }}
              >
                {isExpanded ? "Show less \u25B4" : "Show more \u25BE"}
              </button>
            )}
          </>
        )}

        {/* Tool calls */}
        {visibleToolCalls.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {visibleToolCalls.map((tc, i) => (
              <ToolCallBadge key={i} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
