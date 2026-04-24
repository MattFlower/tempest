// ============================================================
// MessageStream — Port of MessageStreamView.swift
// Scrollable message list with user/assistant styling,
// collapsible tool call badges, and search highlighting.
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { SessionMessage, SessionSummary } from "../../../../shared/ipc-types";
import { ToolCallBadge, HIDDEN_TOOLS } from "./ToolCallBadge";
import { renderInlineMarkdown } from "../inline-markdown";
import { resumeSessionInNewTab } from "../../state/actions";
import { api } from "../../state/rpc-client";
import type { HistoryProvider } from "./SessionList";

interface MessageStreamProps {
  messages: SessionMessage[];
  summary: SessionSummary;
  searchQuery?: string;
  provider: HistoryProvider;
}

/** Strip HTML/XML tags from a string */
function stripTags(str: string): string {
  let result = str;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]+>/g, "");
  } while (result !== previous);
  return result.trim();
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

// --- Command Invocation Parsing ---

interface CommandInvocation {
  commandName: string;
  args: string | null;
  remainingText: string | null;
}

/** Parse command invocation XML tags from user messages (e.g. /brainstorm) */
function parseCommandInvocation(text: string): CommandInvocation | null {
  const nameMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (!nameMatch) return null;

  const commandName = nameMatch[1]!.trim().replace(/^\//, "");

  const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const args = argsMatch ? argsMatch[1]!.trim() || null : null;

  // Get any text not inside tags
  let remaining = text
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .trim();

  return {
    commandName,
    args,
    remainingText: remaining || null,
  };
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

export function MessageStream({ messages, summary, searchQuery, provider }: MessageStreamProps) {
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

  const handleResume = useCallback(() => {
    if (provider === "claude") {
      // Claude's session UUID is the .jsonl basename.
      const fileName = summary.filePath.split("/").pop() ?? summary.filePath;
      const sessionId = fileName.replace(/\.jsonl$/, "");
      resumeSessionInNewTab("claude", sessionId);
    } else if (provider === "codex") {
      // Codex wants the session UUID; resolve it via RPC (reads the rollout
      // header or falls back to the filename pattern).
      void (async () => {
        try {
          const { codexSessionId } = await api.resolveCodexSessionId(summary.filePath);
          if (codexSessionId) {
            resumeSessionInNewTab("codex", codexSessionId);
          } else {
            console.warn(
              `[codex] Could not resolve session id for ${summary.filePath}; rollout file may be missing or malformed.`,
            );
          }
        } catch (err) {
          console.error("[codex] resolveCodexSessionId failed:", err);
        }
      })();
    } else {
      // Pi consumes the absolute .jsonl path via --session <path>.
      resumeSessionInNewTab("pi", summary.filePath);
    }
  }, [provider, summary.filePath]);

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
          <div className="px-4 pt-1 pb-2 flex items-start gap-2">
            <div className="flex-1 min-w-0">
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
            <button
              onClick={handleResume}
              className="text-xs px-2 py-1 rounded shrink-0 cursor-pointer"
              style={{
                backgroundColor: "var(--ctp-blue)",
                color: "white",
              }}
              title={`Open this session in a new ${provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : "Pi"} tab`}
            >
              Resume in new tab
            </button>
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
                    provider={provider}
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

// --- Command Invocation View ---

function CommandInvocationView({ invocation }: { invocation: CommandInvocation }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div>
      {invocation.remainingText && (
        <div
          className="text-[13px] select-text whitespace-pre-wrap break-words mb-1"
          style={{ color: "var(--ctp-text)" }}
        >
          {invocation.remainingText}
        </div>
      )}
      <div className="rounded" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
        <button
          onClick={() => invocation.args && setIsExpanded((p) => !p)}
          className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 rounded cursor-pointer"
        >
          {invocation.args && (
            <span
              className="text-[10px] font-mono"
              style={{ color: "var(--ctp-overlay0)" }}
            >
              {isExpanded ? "\u25BC" : "\u25B6"}
            </span>
          )}
          <span className="text-[10px]" style={{ color: "var(--ctp-overlay0)" }}>
            {"\u276F"}
          </span>
          <span
            className="text-xs font-semibold font-mono"
            style={{ color: "var(--ctp-text)" }}
          >
            /{invocation.commandName}
          </span>
        </button>
        {isExpanded && invocation.args && (
          <div
            className="text-xs select-text px-2.5 pb-2"
            style={{ color: "var(--ctp-text)" }}
          >
            {invocation.args}
          </div>
        )}
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
  const invocation = useMemo(
    () => (msg.text ? parseCommandInvocation(msg.text) : null),
    [msg.text],
  );

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
          invocation ? (
            <div className="mt-1">
              <CommandInvocationView invocation={invocation} />
            </div>
          ) : (
            <div
              className="text-[13px] mt-1 select-text whitespace-pre-wrap break-words"
              style={{ color: "var(--ctp-text)" }}
            >
              {renderInlineMarkdown(msg.text)}
            </div>
          )
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
  provider,
}: {
  msg: SessionMessage;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (index: number) => void;
  provider: HistoryProvider;
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
      {/* Assistant icon badge — Pi logo for Pi sessions, sparkle for Claude */}
      {provider === "pi" ? (
        <div
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: "#11111b" }}
        >
          <svg viewBox="0 0 800 800" width="14" height="14" aria-hidden="true">
            <path
              fill="#fff"
              fillRule="evenodd"
              d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
            />
            <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z" />
          </svg>
        </div>
      ) : provider === "codex" ? (
        <div
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: "#1e3a3a" }}
        >
          <span className="text-[10px] font-semibold" style={{ color: "#94e2d5" }}>
            {"C"}
          </span>
        </div>
      ) : (
        <div
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{
            background: "linear-gradient(135deg, var(--ctp-peach), rgba(250,179,135,0.8))",
          }}
        >
          <span className="text-[11px] text-white">{"\u2726"}</span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-semibold"
            style={{ color: "var(--ctp-subtext0)" }}
          >
            {provider === "pi" ? "PI" : provider === "codex" ? "CODEX" : "CLAUDE"}
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
              {renderInlineMarkdown(msg.text)}
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
