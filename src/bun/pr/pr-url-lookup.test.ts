import { describe, expect, test } from "bun:test";
import { parseGitHubRemote } from "./pr-url-lookup";

describe("parseGitHubRemote", () => {
  test("HTTPS with .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("HTTPS without .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("SSH with .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  test("SSH without .git suffix", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo")).toBe("owner/repo");
  });

  test("non-GitHub remote returns null", () => {
    expect(parseGitHubRemote("https://gitlab.com/owner/repo")).toBeNull();
  });

  test("trims whitespace", () => {
    expect(parseGitHubRemote("  https://github.com/owner/repo.git\n")).toBe("owner/repo");
  });
});
