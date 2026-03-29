// ============================================================
// Diff utility functions for the frontend.
// Parses basic stats from raw diff text.
// ============================================================

/**
 * Parse basic stats from a raw diff string for a single file.
 * Returns counts of added lines, deleted lines, and total hunks.
 */
export function parseDiffFileStats(rawDiff: string): {
  addedLines: number;
  deletedLines: number;
  totalHunks: number;
} {
  let addedLines = 0;
  let deletedLines = 0;
  let totalHunks = 0;

  const lines = rawDiff.split("\n");
  let inHunks = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      totalHunks++;
      inHunks = true;
    } else if (inHunks) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        addedLines++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletedLines++;
      }
    }
  }

  return { addedLines, deletedLines, totalHunks };
}
