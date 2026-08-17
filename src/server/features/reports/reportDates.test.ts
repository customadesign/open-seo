import { describe, expect, it } from "vitest";
import {
  comparisonPeriod,
  deliveryPeriod,
  nextDeliveryRun,
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

describe("delivery schedules", () => {
  it("advances a daily profile to the next local run hour", () => {
    expect(
      nextDeliveryRun({
        after: new Date("2026-08-17T02:00:00Z"),
        timeZone: "Asia/Manila",
        frequency: "daily",
        runHour: 9,
      }),
    ).toBe("2026-08-18T01:00:00.000Z");
  });

  it("advances a weekly profile to the requested weekday", () => {
    // 2026-08-17 is a Monday in Manila; Wednesday is two days later.
    expect(
      nextDeliveryRun({
        after: new Date("2026-08-17T02:00:00Z"),
        timeZone: "Asia/Manila",
        frequency: "weekly",
        runWeekday: 3,
        runHour: 9,
      }),
    ).toBe("2026-08-19T01:00:00.000Z");
  });

  it("keeps the local run hour across a DST transition", () => {
    // US DST ends 2026-11-01: a daily 09:00 America/New_York schedule shifts
    // from 13:00Z to 14:00Z rather than drifting an hour earlier.
    expect(
      nextDeliveryRun({
        after: new Date("2026-10-31T14:00:00Z"),
        timeZone: "America/New_York",
        frequency: "daily",
        runHour: 9,
      }),
    ).toBe("2026-11-01T14:00:00.000Z");
  });

  it("reports the last complete window for each frequency", () => {
    const at = new Date("2026-08-17T02:00:00Z");
    expect(deliveryPeriod("daily", at, "Asia/Manila")).toEqual({
      periodStart: "2026-08-16",
      periodEnd: "2026-08-16",
      compareStart: "2026-08-15",
      compareEnd: "2026-08-15",
    });
    expect(deliveryPeriod("weekly", at, "Asia/Manila")).toEqual({
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      compareStart: "2026-08-03",
      compareEnd: "2026-08-09",
    });
    expect(deliveryPeriod("monthly", at, "Asia/Manila")).toEqual(
      previousFullCalendarMonth(at, "Asia/Manila"),
    );
  });
});
