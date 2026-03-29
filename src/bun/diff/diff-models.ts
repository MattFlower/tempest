// ============================================================
// Diff data models — port of DiffModels.swift
// Structured representation of unified diff output.
// ============================================================

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: "modified" | "added" | "deleted" | "renamed";
  hunks: DiffHunk[];
  rawDiff: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "delete";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}
