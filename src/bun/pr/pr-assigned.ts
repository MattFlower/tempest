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

  const proc = Bun.spawn(
    [
      ghPath,
      "search",
      "prs",
      "--review-requested=@me",
      "--state=open",
      "--json",
      "number,title,url,repository",
      "--limit",
      "50",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.warn("[pr-assigned] gh search failed, exit code:", proc.exitCode);
    return [];
  }

  try {
    const results: GHSearchResult[] = JSON.parse(stdout);
    return results.map((r) => {
      const [owner, repo] = r.repository.nameWithOwner.split("/");
      return {
        owner: owner!,
        repo: repo!,
        number: r.number,
        title: r.title,
        url: r.url,
      };
    });
  } catch (err) {
    console.warn("[pr-assigned] Failed to parse gh output:", err);
    return [];
  }
}

export async function getAssignedPRs(): Promise<AssignedPR[]> {
  if (cachedResult !== null) return cachedResult;

  if (fetchPromise) return fetchPromise;

  fetchPromise = fetchFromGH().then((result) => {
    cachedResult = result;
    fetchPromise = null;
    return result;
  });

  return fetchPromise;
}

export async function refreshAssignedPRs(): Promise<AssignedPR[]> {
  cachedResult = null;
  fetchPromise = null;
  return getAssignedPRs();
}
