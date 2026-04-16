import { describe, it, expect } from "bun:test";
import { parseResponse, todayString, projectSlug, formatTokens } from "./usage-service";

describe("parseResponse", () => {
  it("parses per-project breakdowns from --instances response", () => {
    const input = JSON.stringify({
      projects: {
        "-Users-me-code-project-a": [
          { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, totalCost: 0.5 },
        ],
        "-Users-me-code-project-b": [
          { inputTokens: 300, outputTokens: 150, cacheReadTokens: 30, totalCost: 1.5 },
        ],
      },
    });

    const result = parseResponse(input);
    expect(result.projectBreakdowns["-Users-me-code-project-a"]).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, totalCost: 0.5,
    });
    expect(result.projectBreakdowns["-Users-me-code-project-b"]).toEqual({
      inputTokens: 300, outputTokens: 150, cacheReadTokens: 30, totalCost: 1.5,
    });
  });

  it("computes dailyTotals by summing all project breakdowns", () => {
    const input = JSON.stringify({
      projects: {
        "project-a": [
          { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, totalCost: 0.5 },
        ],
        "project-b": [
          { inputTokens: 300, outputTokens: 150, cacheReadTokens: 30, totalCost: 1.5 },
        ],
      },
    });

    const result = parseResponse(input);
    expect(result.dailyTotals).toEqual({
      inputTokens: 400, outputTokens: 200, cacheReadTokens: 40, totalCost: 2.0,
    });
  });

  it("sums all entries per project for multi-day ranges", () => {
    const input = JSON.stringify({
      projects: {
        "project-a": [
          { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, totalCost: 0.5 },
          { inputTokens: 900, outputTokens: 150, cacheReadTokens: 90, totalCost: 1.5 },
        ],
      },
    });

    const result = parseResponse(input);
    expect(result.projectBreakdowns["project-a"]).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 100,
      totalCost: 2.0,
    });
    expect(result.dailyTotals).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 100,
      totalCost: 2.0,
    });
  });

  it("falls back to totals when no projects", () => {
    const input = JSON.stringify({
      totals: { inputTokens: 500, outputTokens: 250, cacheReadTokens: 50, totalCost: 3.0 },
    });

    const result = parseResponse(input);
    expect(result.dailyTotals).toEqual({
      inputTokens: 500, outputTokens: 250, cacheReadTokens: 50, totalCost: 3.0,
    });
    expect(Object.keys(result.projectBreakdowns)).toHaveLength(0);
  });

  it("falls back to totals when projects is empty", () => {
    const input = JSON.stringify({
      projects: {},
      totals: { inputTokens: 500, outputTokens: 250, cacheReadTokens: 50, totalCost: 3.0 },
    });

    const result = parseResponse(input);
    expect(result.dailyTotals).toEqual({
      inputTokens: 500, outputTokens: 250, cacheReadTokens: 50, totalCost: 3.0,
    });
  });

  it("returns null dailyTotals for invalid JSON", () => {
    const result = parseResponse("not valid json");
    expect(result.dailyTotals).toBeNull();
    expect(result.projectBreakdowns).toEqual({});
  });

  it("returns null dailyTotals for empty string", () => {
    const result = parseResponse("");
    expect(result.dailyTotals).toBeNull();
  });

  it("skips invalid project entries and keeps valid ones", () => {
    const input = JSON.stringify({
      projects: {
        "project-a": [
          { inputTokens: 100 }, // missing outputTokens, cacheReadTokens, totalCost
          { inputTokens: 25, outputTokens: 10, cacheReadTokens: 5, totalCost: 0.2 },
        ],
      },
    });

    const result = parseResponse(input);
    expect(result.projectBreakdowns["project-a"]).toEqual({
      inputTokens: 25,
      outputTokens: 10,
      cacheReadTokens: 5,
      totalCost: 0.2,
    });
    expect(result.dailyTotals).toEqual({
      inputTokens: 25,
      outputTokens: 10,
      cacheReadTokens: 5,
      totalCost: 0.2,
    });
  });

  it("skips non-array project entries", () => {
    const input = JSON.stringify({
      projects: { "project-a": "not-an-array" },
    });

    const result = parseResponse(input);
    expect(Object.keys(result.projectBreakdowns)).toHaveLength(0);
  });
});

describe("todayString", () => {
  it("returns a string in YYYYMMDD format", () => {
    const result = todayString();
    expect(result).toMatch(/^\d{8}$/);
  });

  it("matches today's date", () => {
    const now = new Date();
    const expected =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    expect(todayString()).toBe(expected);
  });
});

describe("projectSlug", () => {
  it("converts workspace path to ccusage slug format", () => {
    expect(projectSlug("/Users/me/code/project")).toBe("-Users-me-code-project");
  });

  it("handles paths with no slashes", () => {
    expect(projectSlug("project")).toBe("project");
  });

  it("handles paths with trailing slash", () => {
    expect(projectSlug("/Users/dev/code/")).toBe("-Users-dev-code-");
  });
});

describe("formatTokens", () => {
  it("returns small numbers as-is", () => {
    expect(formatTokens(288)).toBe("288");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokens(4_448)).toBe("4.4K");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(12_684_109)).toBe("12.7M");
  });

  it("returns zero as '0'", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("formats exact 1000 as 1.0K", () => {
    expect(formatTokens(1_000)).toBe("1.0K");
  });

  it("formats exact 1000000 as 1.0M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });
});
