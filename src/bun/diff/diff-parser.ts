// ============================================================
// Unified diff parser — port of DiffProvider.swift's UnifiedDiffParser.
// Parses raw unified diff output (from git diff / jj diff) into
// structured FileDiff objects.
// ============================================================

import type { FileDiff, DiffHunk, DiffLine } from "./diff-models";

/**
 * Parse a unified diff string into an array of FileDiff objects.
 * Handles git and jj diff output formats.
 */
export function parseDiff(raw: string): FileDiff[] {
  const lines = raw.split("\n");
  const files: FileDiff[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Look for file boundary: "diff --git a/path b/path"
    if (line.startsWith("diff --git ")) {
      const { fileDiff, nextIndex } = parseFileDiff(lines, i);
      if (fileDiff) {
        files.push(fileDiff);
      }
      i = nextIndex;
    } else {
      i += 1;
    }
  }

  return files;
}

function parseFileDiff(
  lines: string[],
  startIndex: number,
): { fileDiff: FileDiff | null; nextIndex: number } {
  const diffLine = lines[startIndex]!;
  let i = startIndex + 1;

  // Extract file paths from "diff --git a/path b/path"
  const { oldPath, newPath } = extractPaths(diffLine);
  let status: FileDiff["status"] = "modified";

  // Process header lines (index, ---, +++, new file mode, deleted file mode, rename from/to)
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      break;
    }

    if (line.startsWith("new file mode")) {
      status = "added";
    } else if (line.startsWith("deleted file mode")) {
      status = "deleted";
    } else if (line.startsWith("rename from ")) {
      status = "renamed";
    } else if (line.startsWith("@@")) {
      // Start of hunks — parse them
      const { hunks, nextIndex } = parseHunks(lines, i);
      const rawDiff = lines.slice(startIndex, nextIndex).join("\n");

      const path = newPath ?? oldPath ?? "unknown";
      return {
        fileDiff: {
          oldPath: oldPath ?? path,
          newPath: path,
          status,
          hunks,
          rawDiff,
        },
        nextIndex,
      };
    }

    i += 1;
  }

  // File with no hunks (e.g., binary file, permission change)
  const path = newPath ?? oldPath ?? "unknown";
  const rawDiff = lines.slice(startIndex, i).join("\n");
  return {
    fileDiff: {
      oldPath: oldPath ?? path,
      newPath: path,
      status,
      hunks: [],
      rawDiff,
    },
    nextIndex: i,
  };
}

function parseHunks(
  lines: string[],
  startIndex: number,
): { hunks: DiffHunk[]; nextIndex: number } {
  const hunks: DiffHunk[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      break;
    }

    if (line.startsWith("@@")) {
      const { hunk, nextIndex } = parseOneHunk(lines, i);
      hunks.push(hunk);
      i = nextIndex;
    } else {
      i += 1;
    }
  }

  return { hunks, nextIndex: i };
}

function parseOneHunk(
  lines: string[],
  startIndex: number,
): { hunk: DiffHunk; nextIndex: number } {
  const header = lines[startIndex]!;
  const diffLines: DiffLine[] = [];
  let i = startIndex + 1;

  // Parse line numbers from header: @@ -old,count +new,count @@
  const { oldStart, oldCount, newStart, newCount } = parseHunkHeader(header);
  let oldLine = oldStart;
  let newLine = newStart;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ") || line.startsWith("@@")) {
      break;
    }

    if (line.startsWith("-")) {
      diffLines.push({
        type: "delete",
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: undefined,
      });
      oldLine += 1;
    } else if (line.startsWith("+")) {
      diffLines.push({
        type: "add",
        content: line.slice(1),
        oldLineNumber: undefined,
        newLineNumber: newLine,
      });
      newLine += 1;
    } else if (line.startsWith(" ") || line === "") {
      const content = line === "" ? "" : line.slice(1);
      diffLines.push({
        type: "context",
        content,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
    } else {
      // Unknown line format — treat as context
      diffLines.push({
        type: "context",
        content: line,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }

    i += 1;
  }

  return {
    hunk: {
      oldStart,
      oldCount,
      newStart,
      newCount,
      header,
      lines: diffLines,
    },
    nextIndex: i,
  };
}

function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} {
  // @@ -10,5 +10,7 @@ optional context
  const match = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    return { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0 };
  }

  return {
    oldStart: parseInt(match[1]!, 10),
    oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3]!, 10),
    newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
  };
}

function extractPaths(diffLine: string): {
  oldPath: string | null;
  newPath: string | null;
} {
  // "diff --git a/path/to/file b/path/to/file"
  const stripped = diffLine.replace("diff --git ", "");
  const parts = stripped.split(" b/");
  if (parts.length < 2) return { oldPath: null, newPath: null };

  const oldPath = parts[0]!.startsWith("a/") ? parts[0]!.slice(2) : parts[0]!;
  const newPath = parts.slice(1).join(" b/"); // Handle files with " b/" in name
  return { oldPath, newPath };
}
