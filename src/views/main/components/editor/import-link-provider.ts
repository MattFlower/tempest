// ============================================================
// ImportLinkProvider — Monaco LinkProvider that resolves
// TypeScript/JavaScript import specifiers to file paths,
// making them Cmd+clickable in the editor.
// ============================================================

import { api } from "../../state/rpc-client";

// Regex patterns to find import specifiers in TS/JS.
// Each captures the full match, the quote character, and the specifier.
const IMPORT_PATTERNS = [
  // import ... from "specifier"
  /from\s+(["'])([^"']+)\1/g,
  // require("specifier")
  /require\(\s*(["'])([^"']+)\1\s*\)/g,
  // import("specifier") — dynamic import
  /import\(\s*(["'])([^"']+)\1\s*\)/g,
];

export const TEMPEST_FILE_SCHEME = "tempest-file://";

interface ILink {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  url?: string;
  tooltip?: string;
}

interface ILinksList {
  links: ILink[];
}

/**
 * Provides clickable links for import specifiers in TypeScript/JavaScript files.
 * Resolves specifiers via the backend using Bun.resolveSync.
 */
export class ImportLinkProvider {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async provideLinks(model: any): Promise<ILinksList> {
    const links: ILink[] = [];
    const lineCount = model.getLineCount();

    // Collect all specifier matches with their positions
    const pending: { specifier: string; lineNumber: number; startCol: number; endCol: number }[] = [];

    for (let line = 1; line <= lineCount; line++) {
      const lineContent = model.getLineContent(line);

      for (const pattern of IMPORT_PATTERNS) {
        // Reset regex lastIndex for each line
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;

        while ((match = regex.exec(lineContent)) !== null) {
          const specifier = match[2];
          if (!specifier) continue;

          // Find the position of the specifier within the full match
          const quoteChar = match[1];
          const specifierStart = lineContent.indexOf(
            quoteChar + specifier + quoteChar,
            match.index,
          );
          if (specifierStart === -1) continue;

          // +2 for 1-based column and opening quote
          const startCol = specifierStart + 2;
          const endCol = startCol + specifier.length;

          pending.push({ specifier, lineNumber: line, startCol, endCol });
        }
      }
    }

    // Resolve all specifiers in parallel
    const results = await Promise.all(
      pending.map((p) =>
        api
          .resolveModulePath(p.specifier, this.filePath)
          .then((r: any) => ({ ...p, resolvedPath: r.resolvedPath }))
          .catch(() => ({ ...p, resolvedPath: null })),
      ),
    );

    for (const r of results) {
      if (!r.resolvedPath) continue;

      links.push({
        range: {
          startLineNumber: r.lineNumber,
          startColumn: r.startCol,
          endLineNumber: r.lineNumber,
          endColumn: r.endCol,
        },
        url: TEMPEST_FILE_SCHEME + encodeURIComponent(r.resolvedPath),
        tooltip: r.resolvedPath,
      });
    }

    return { links };
  }
}
