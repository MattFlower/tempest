// ============================================================
// Unit tests for the unified diff parser.
// ============================================================

import { describe, test, expect } from "bun:test";
import { parseDiff } from "./diff-parser";

describe("parseDiff", () => {
  test("parses simple unified diff with one file, one hunk", () => {
    const raw = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { foo } from "bar";

-const old = "value";
+const updated = "new value";
+const extra = true;

 export default foo;`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.oldPath).toBe("src/index.ts");
    expect(files[0]!.newPath).toBe("src/index.ts");
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.hunks).toHaveLength(1);

    const hunk = files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(5);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(6);

    // Check line types
    const types = hunk.lines.map((l) => l.type);
    expect(types).toEqual([
      "context", // import { foo }
      "context", // empty line
      "delete",  // -const old
      "add",     // +const updated
      "add",     // +const extra
      "context", // empty line
      "context", // export default
    ]);

    // Check line numbers
    const deleteLine = hunk.lines.find((l) => l.type === "delete")!;
    expect(deleteLine.oldLineNumber).toBe(3);
    expect(deleteLine.newLineNumber).toBeUndefined();

    const addLines = hunk.lines.filter((l) => l.type === "add");
    expect(addLines[0]!.newLineNumber).toBe(3);
    expect(addLines[0]!.oldLineNumber).toBeUndefined();
    expect(addLines[1]!.newLineNumber).toBe(4);
  });

  test("parses diff with multiple files", () => {
    const raw = `diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
diff --git a/file2.ts b/file2.ts
index abc..def 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 first
+added
 last`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0]!.newPath).toBe("file1.ts");
    expect(files[1]!.newPath).toBe("file2.ts");
  });

  test("parses added file", () => {
    const raw = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+line1
+line2
+line3`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.newPath).toBe("new-file.ts");
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]!.lines).toHaveLength(3);
    expect(files[0]!.hunks[0]!.lines.every((l) => l.type === "add")).toBe(true);
  });

  test("parses deleted file", () => {
    const raw = `diff --git a/old-file.ts b/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("deleted");
    expect(files[0]!.newPath).toBe("old-file.ts");
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]!.lines.every((l) => l.type === "delete")).toBe(true);
  });

  test("parses renamed file", () => {
    const raw = `diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
index abc..def 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("renamed");
    expect(files[0]!.oldPath).toBe("old-name.ts");
    expect(files[0]!.newPath).toBe("new-name.ts");
  });

  test("parses multiple hunks in one file", () => {
    const raw = `diff --git a/big-file.ts b/big-file.ts
index abc..def 100644
--- a/big-file.ts
+++ b/big-file.ts
@@ -1,3 +1,3 @@
 first
-old1
+new1
 third
@@ -10,3 +10,3 @@
 before
-old2
+new2
 after`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.hunks).toHaveLength(2);

    const hunk1 = files[0]!.hunks[0]!;
    expect(hunk1.oldStart).toBe(1);
    expect(hunk1.newStart).toBe(1);

    const hunk2 = files[0]!.hunks[1]!;
    expect(hunk2.oldStart).toBe(10);
    expect(hunk2.newStart).toBe(10);
  });

  test("handles empty diff", () => {
    const files = parseDiff("");
    expect(files).toHaveLength(0);
  });

  test("handles whitespace-only diff", () => {
    const files = parseDiff("  \n  \n");
    expect(files).toHaveLength(0);
  });

  test("handles malformed diff gracefully", () => {
    const raw = `some random text
not a diff at all
just garbage`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(0);
  });

  test("handles diff with no hunks (binary file)", () => {
    const raw = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/image.png differ`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.hunks).toHaveLength(0);
  });

  test("tracks line numbers correctly through hunks", () => {
    const raw = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -5,7 +5,8 @@
 context5
 context6
-deleted7
+added7a
+added7b
 context8
 context9
 context10`;

    const files = parseDiff(raw);
    const hunk = files[0]!.hunks[0]!;

    // First context line should be old=5, new=5
    expect(hunk.lines[0]!.oldLineNumber).toBe(5);
    expect(hunk.lines[0]!.newLineNumber).toBe(5);

    // Second context line should be old=6, new=6
    expect(hunk.lines[1]!.oldLineNumber).toBe(6);
    expect(hunk.lines[1]!.newLineNumber).toBe(6);

    // Delete line: old=7, no new
    expect(hunk.lines[2]!.type).toBe("delete");
    expect(hunk.lines[2]!.oldLineNumber).toBe(7);
    expect(hunk.lines[2]!.newLineNumber).toBeUndefined();

    // First add line: no old, new=7
    expect(hunk.lines[3]!.type).toBe("add");
    expect(hunk.lines[3]!.oldLineNumber).toBeUndefined();
    expect(hunk.lines[3]!.newLineNumber).toBe(7);

    // Second add line: no old, new=8
    expect(hunk.lines[4]!.type).toBe("add");
    expect(hunk.lines[4]!.oldLineNumber).toBeUndefined();
    expect(hunk.lines[4]!.newLineNumber).toBe(8);

    // Context after adds: old=8, new=9
    expect(hunk.lines[5]!.type).toBe("context");
    expect(hunk.lines[5]!.oldLineNumber).toBe(8);
    expect(hunk.lines[5]!.newLineNumber).toBe(9);
  });

  test("handles 'no newline at end of file' marker", () => {
    const raw = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
\\ No newline at end of file`;

    const files = parseDiff(raw);
    const hunk = files[0]!.hunks[0]!;
    // The "\ No newline" line should be skipped
    expect(hunk.lines).toHaveLength(3);
    expect(hunk.lines.map((l) => l.type)).toEqual(["context", "delete", "add"]);
  });

  test("handles hunk header without count (single line)", () => {
    const raw = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new`;

    const files = parseDiff(raw);
    const hunk = files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(1);
  });

  test("preserves rawDiff for each file", () => {
    const raw = `diff --git a/a.ts b/a.ts
index abc..def 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old
+new
 end
diff --git a/b.ts b/b.ts
index abc..def 100644
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old2
+new2`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);

    // Each file's rawDiff should contain its own diff section
    expect(files[0]!.rawDiff).toContain("a.ts");
    expect(files[0]!.rawDiff).not.toContain("b.ts");
    expect(files[1]!.rawDiff).toContain("b.ts");
  });

  test("handles jj diff format (same as git format)", () => {
    const raw = `diff --git a/src/main.rs b/src/main.rs
index abc1234..def5678 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,4 +1,5 @@
 fn main() {
-    println!("old");
+    println!("new");
+    println!("extra");
 }`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.newPath).toBe("src/main.rs");
    expect(files[0]!.hunks[0]!.lines.filter((l) => l.type === "add")).toHaveLength(2);
    expect(files[0]!.hunks[0]!.lines.filter((l) => l.type === "delete")).toHaveLength(1);
  });
});
