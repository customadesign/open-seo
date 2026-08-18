import { beforeEach, describe, expect, it, vi } from "vitest";

const { record } = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/features/change-events/services/ChangeEventService", () => ({
  ChangeEventService: { record },
}));

import {
  analyzeGscSearchPerformanceChange,
  buildGscChangeEvents,
  GscChangeEventService,
  type GscSearchTotals,
} from "./GscChangeEventService";

function totals(overrides: Partial<GscSearchTotals> = {}): GscSearchTotals {
  return {
    clicks: 100,
    impressions: 1000,
    ctr: 0.1,
    position: 8,
    ...overrides,
  };
}

const context = {
  projectId: "11111111-1111-4111-8111-111111111111",
  dateRange: "last_28_days" as const,
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  prevStartDate: "2026-06-03",
  prevEndDate: "2026-06-30",
};

describe("analyzeGscSearchPerformanceChange", () => {
  it("emits clicks when absolute and relative thresholds both pass", () => {
    expect(
      analyzeGscSearchPerformanceChange(totals({ clicks: 130 }), totals()),
    ).toContainEqual({
      metricKey: "clicks",
      direction: "gain",
      previousValue: 100,
      currentValue: 130,
    });
  });

  it("skips clicks when the previous baseline is too small or the change is not finite", () => {
    expect(
      analyzeGscSearchPerformanceChange(
        totals({ clicks: 40 }),
        totals({ clicks: 0 }),
      ).some((change) => change.metricKey === "clicks"),
    ).toBe(false);
    expect(
      analyzeGscSearchPerformanceChange(
        totals({ clicks: Number.NaN }),
        totals(),
      ).some((change) => change.metricKey === "clicks"),
    ).toBe(false);
    expect(
      analyzeGscSearchPerformanceChange(totals({ clicks: 108 }), totals()).some(
        (change) => change.metricKey === "clicks",
      ),
    ).toBe(false);
  });

  it("emits impressions only past 100 absolute and 25 percent", () => {
    expect(
      analyzeGscSearchPerformanceChange(
        totals({ impressions: 1250 }),
        totals(),
      ).some((change) => change.metricKey === "impressions"),
    ).toBe(true);
    expect(
      analyzeGscSearchPerformanceChange(
        totals({ impressions: 1080 }),
        totals(),
      ).some((change) => change.metricKey === "impressions"),
    ).toBe(false);
  });

  it("emits CTR only with 2 points and 100 impressions in both periods", () => {
    expect(
      analyzeGscSearchPerformanceChange(totals({ ctr: 0.13 }), totals()),
    ).toContainEqual({
      metricKey: "ctr",
      direction: "gain",
      previousValue: 0.1,
      currentValue: 0.13,
    });
    expect(
      analyzeGscSearchPerformanceChange(
        totals({ ctr: 0.13, impressions: 80 }),
        totals({ impressions: 80 }),
      ).some((change) => change.metricKey === "ctr"),
    ).toBe(false);
  });

  it("treats a better average position as an opportunity", () => {
    expect(
      analyzeGscSearchPerformanceChange(totals({ position: 5.5 }), totals()),
    ).toContainEqual({
      metricKey: "position",
      direction: "gain",
      previousValue: 8,
      currentValue: 5.5,
    });
  });

  it("treats a worse average position as a warning", () => {
    expect(
      analyzeGscSearchPerformanceChange(totals({ position: 11 }), totals()),
    ).toContainEqual({
      metricKey: "position",
      direction: "decline",
      previousValue: 8,
      currentValue: 11,
    });
  });
});

describe("buildGscChangeEvents", () => {
  it("includes the date range and active filters in the dedupe key and summary", () => {
    const [event] = buildGscChangeEvents({
      ...context,
      device: "MOBILE",
      country: "usa",
      current: totals({ clicks: 140 }),
      previous: totals(),
    });
    expect(event).toMatchObject({
      source: "gsc",
      eventType: "gsc.clicks.gain",
      severity: "opportunity",
      dedupeKey: "gsc:last_28_days:2026-07-01:2026-07-28:MOBILE:usa:clicks",
    });
    expect(event.summary).toContain("Last 28 days (2026-07-01 to 2026-07-28)");
    expect(event.summary).toContain("2026-06-03 to 2026-06-30");
    expect(event.summary).toContain("Filtered to Mobile, USA.");
    expect(event.title).toBe("Search clicks rose 40%");
  });

  it("uses warning severity for declines and no events when every metric is quiet", () => {
    const [event] = buildGscChangeEvents({
      ...context,
      current: totals({ clicks: 70 }),
      previous: totals(),
    });
    expect(event).toMatchObject({
      eventType: "gsc.clicks.decline",
      severity: "warning",
    });
    expect(
      buildGscChangeEvents({
        ...context,
        current: totals({
          clicks: 105,
          impressions: 1040,
          ctr: 0.101,
          position: 7.5,
        }),
        previous: totals(),
      }),
    ).toEqual([]);
  });
});

describe("GscChangeEventService.recordFromReport", () => {
  beforeEach(() => {
    record.mockResolvedValue({ id: "event-1" });
  });

  it("does not fail the report when event persistence throws", async () => {
    record.mockRejectedValue(new Error("db unavailable"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      GscChangeEventService.recordFromReport({
        ...context,
        current: totals({ clicks: 140 }),
        previous: totals(),
      }),
    ).resolves.toEqual({ recorded: 0 });
    logged.mockRestore();
  });
});
