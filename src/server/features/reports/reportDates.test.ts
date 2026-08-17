import { describe, expect, it } from "vitest";
import {
  comparisonPeriod,
  nextMonthlyRun,
  previousFullCalendarMonth,
  resolveDueMonthlyOccurrence,
} from "./reportDates";

describe("report dates", () => {
  it("uses the previous full calendar month and its predecessor", () => {
    expect(
      previousFullCalendarMonth(
        new Date("2026-08-17T01:00:00Z"),
        "Asia/Manila",
      ),
    ).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      compareStart: "2026-06-01",
      compareEnd: "2026-06-30",
    });
  });

  it("preserves the requested period length for manual comparisons", () => {
    expect(comparisonPeriod("2026-07-05", "2026-07-14")).toEqual({
      compareStart: "2026-06-25",
      compareEnd: "2026-07-04",
    });
  });

  it("schedules the fourth day at 9am in the project timezone", () => {
    expect(
      nextMonthlyRun({
        after: new Date("2026-08-03T23:00:00Z"),
        timeZone: "Asia/Manila",
        runDay: 4,
        runHour: 9,
      }),
    ).toBe("2026-08-04T01:00:00.000Z");
  });

  it("collapses the occurrences a stopped deployment missed into one claim", () => {
    expect(
      resolveDueMonthlyOccurrence({
        scheduledFor: new Date("2026-05-04T01:00:00.000Z"),
        now: new Date("2026-08-17T01:00:00.000Z"),
        timeZone: "Asia/Manila",
        runDay: 4,
        runHour: 9,
      }),
    ).toEqual({
      occurrence: "2026-08-04T01:00:00.000Z",
      nextRunAt: "2026-09-04T01:00:00.000Z",
    });
  });
});
