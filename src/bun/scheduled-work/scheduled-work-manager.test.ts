import { describe, expect, it } from "bun:test";
import { computeNextRunAt } from "./scheduled-work-manager";

describe("computeNextRunAt", () => {
  it("computes the next interval run after the start date", () => {
    const next = computeNextRunAt(
      {
        type: "interval",
        every: 2,
        unit: "hours",
        startAt: "2026-05-07T10:00:00.000Z",
      },
      new Date("2026-05-07T13:30:00.000Z"),
    );

    expect(next).toBe("2026-05-07T14:00:00.000Z");
  });

  it("computes the next five-field cron run", () => {
    const expected = new Date(2026, 4, 8, 9, 15, 0, 0).toISOString();
    const next = computeNextRunAt(
      { type: "cron", expression: "15 9 * * 1-5" },
      new Date(2026, 4, 7, 9, 16, 0, 0),
    );

    expect(next).toBe(expected);
  });

  it("rejects malformed cron expressions", () => {
    const next = computeNextRunAt(
      { type: "cron", expression: "not a cron" },
      new Date("2026-05-07T09:16:00.000Z"),
    );

    expect(next).toBeUndefined();
  });

  it("uses cron-style OR matching when both day fields are restricted", () => {
    const expected = new Date(2026, 4, 8, 9, 0, 0, 0).toISOString();
    const next = computeNextRunAt(
      { type: "cron", expression: "0 9 1 * 5" },
      new Date(2026, 4, 7, 9, 16, 0, 0),
    );

    expect(next).toBe(expected);
  });
});
