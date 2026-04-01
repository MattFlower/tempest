// ============================================================
// File service for the Monaco editor — reads and writes raw
// file content, infers Monaco language ID from file extension.
// ============================================================

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  clj: "clojure",
  scala: "scala",
  zig: "zig",
};

function inferLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";

  // Handle special filenames
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";

  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
  return ext ? (EXT_TO_LANGUAGE[ext] ?? "plaintext") : "plaintext";
}

export async function readFileForEditor(
  filePath: string,
): Promise<{ content: string; language: string }> {
  const file = Bun.file(filePath);
  const content = await file.text();
  const language = inferLanguage(filePath);
  return { content, language };
}

export async function writeFileForEditor(
  filePath: string,
  content: string,
): Promise<void> {
  await Bun.write(filePath, content);
}

export function resolveModulePath(
  specifier: string,
  fromFilePath: string,
): { resolvedPath: string | null } {
  try {
    const dir = fromFilePath.replace(/\/[^/]+$/, "");
    const resolved = Bun.resolveSync(specifier, dir);
    return { resolvedPath: resolved };
  } catch {
    return { resolvedPath: null };
  }
}
