// ============================================================
// PR Assigned — Fetches PRs assigned to the current GitHub user.
// Uses `gh search prs` to find open PRs where the user is
// a requested reviewer or assignee.
//
// Results are cached after the first fetch. Call refreshAssignedPRs()
// to clear the cache and re-fetch (e.g. from a UI refresh button).
// ============================================================

import type { AssignedPR } from "../../shared/ipc-types";
import { PathResolver } from "../config/path-resolver";

const pathResolver = new PathResolver();

interface GHSearchResult {
  number: number;
  title: string;
  url: string;
  repository: { nameWithOwner: string };
}

let cachedResult: AssignedPR[] | null = null;
let fetchPromise: Promise<AssignedPR[]> | null = null;

async function fetchFromGH(): Promise<AssignedPR[]> {
  let ghPath: string;
  try {
    ghPath = pathResolver.resolve("gh");
  } catch {
    return [];
  }

  async function runSearch(filter: string): Promise<GHSearchResult[]> {
    const proc = Bun.spawn(
      [
        ghPath,
        "search",
        "prs",
        filter,
        "--state=open",
        "--json",
        "number,title,url,repository",
        "--limit",
        "50",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      console.warn(
        `[pr-assigned] gh search failed for '${filter}' (exit ${proc.exitCode}): ${stderr.trim()}`,
      );
      return [];
    }

    try {
      const results: GHSearchResult[] = JSON.parse(stdout);
      return Array.isArray(results) ? results : [];
    } catch (err) {
      console.warn("[pr-assigned] Failed to parse gh output:", err);
      return [];
    }
  }

  // Run separate searches because gh search combines qualifiers with AND.
  // We need (review-requested=@me) OR (assignee=@me).
  const [reviewRequested, assigned] = await Promise.all([
    runSearch("--review-requested=@me"),
    runSearch("--assignee=@me"),
  ]);

  const merged = new Map<string, AssignedPR>();
  for (const r of [...reviewRequested, ...assigned]) {
    const [owner, repo] = r.repository.nameWithOwner.split("/");
    if (!owner || !repo) continue;

    const key = `${owner}/${repo}#${r.number}`;
    merged.set(key, {
      owner,
      repo,
      number: r.number,
      title: r.title,
      url: r.url,
    });
  }

  return Array.from(merged.values());
}

export async function getAssignedPRs(): Promise<AssignedPR[]> {
  if (cachedResult !== null) return cachedResult;

  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const result = await fetchFromGH();
      cachedResult = result;
      return result;
    } catch (err) {
      console.warn("[pr-assigned] fetch failed:", err);
      return [];
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export async function refreshAssignedPRs(): Promise<AssignedPR[]> {
  cachedResult = null;
  fetchPromise = null;
  return getAssignedPRs();
}
