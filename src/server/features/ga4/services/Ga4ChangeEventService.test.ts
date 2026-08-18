import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/features/change-events/services/ChangeEventService", () => ({
  ChangeEventService: { record: mocks.record },
}));

import {
  analyzeGa4DashboardChanges,
  Ga4ChangeEventService,
} from "./Ga4ChangeEventService";
import type { Ga4ReportMetadata } from "./Ga4ReportNormalization";

const period = {
  startDate: "2026-07-09",
  endDate: "2026-08-05",
  previousStartDate: "2026-06-11",
  previousEndDate: "2026-07-08",
};

function metadata(
  overrides: Partial<Ga4ReportMetadata> = {},
): Ga4ReportMetadata {
  return {
    dataLossFromOtherRow: false,
    subjectToThresholding: false,
    sampling: [],
    restrictedMetrics: [],
    emptyReason: null,
    hasLimitedData: false,
    ...overrides,
  };
}

function metrics(
  overrides: Partial<
    Parameters<typeof analyzeGa4DashboardChanges>[0]["current"]
  > = {},
) {
  return {
    sessions: 80,
    keyEvents: 10,
    sessionKeyEventRate: 0.125,
    engagementRate: 0.6,
    ...overrides,
  };
}

function analyze(
  current = metrics(),
  previous = metrics(),
  currentMetadata = metadata(),
  previousMetadata = metadata(),
) {
  return analyzeGa4DashboardChanges({
    current,
    previous,
    currentMetadata,
    previousMetadata,
    period,
  });
}

describe("analyzeGa4DashboardChanges", () => {
  it("emits session and key-event moves that meet volume and magnitude guards", () => {
    const events = analyze(
      metrics({ sessions: 100, keyEvents: 14 }),
      metrics({ sessions: 80, keyEvents: 10 }),
    );

    expect(events.map((event) => event.metricKey)).toEqual([
      "sessions",
      "keyEvents",
    ]);
    expect(events[0]).toMatchObject({
      eventType: "ga4.sessions.increase",
      severity: "opportunity",
      previousNumericValue: 80,
      currentNumericValue: 100,
    });
    expect(events[1]).toMatchObject({
      eventType: "ga4.key_events.increase",
      previousNumericValue: 10,
      currentNumericValue: 14,
    });
  });

  it("suppresses low-volume or small session and key-event moves", () => {
    expect(
      analyze(
        metrics({ sessions: 40, keyEvents: 10 }),
        metrics({ sessions: 19, keyEvents: 10 }),
      ),
    ).toEqual([]);
    expect(
      analyze(
        metrics({ sessions: 99, keyEvents: 10 }),
        metrics({ sessions: 80, keyEvents: 10 }),
      ),
    ).toEqual([]);
    expect(
      analyze(
        metrics({ sessions: 80, keyEvents: 20 }),
        metrics({ sessions: 80, keyEvents: 4 }),
      ),
    ).toEqual([]);
    expect(
      analyze(
        metrics({ sessions: 80, keyEvents: 12 }),
        metrics({ sessions: 80, keyEvents: 10 }),
      ),
    ).toEqual([]);
  });

  it("emits rate moves of at least 5 percentage points when prior sessions are sufficient", () => {
    const events = analyze(
      metrics({
        sessions: 82,
        sessionKeyEventRate: 0.18,
        engagementRate: 0.67,
      }),
      metrics({
        sessions: 80,
        sessionKeyEventRate: 0.12,
        engagementRate: 0.6,
      }),
    );

    expect(events.map((event) => event.metricKey)).toEqual([
      "sessionKeyEventRate",
      "engagementRate",
    ]);
    expect(events[0]).toMatchObject({
      eventType: "ga4.session_key_event_rate.increase",
      severity: "opportunity",
      previousNumericValue: 0.12,
      currentNumericValue: 0.18,
    });
  });

  it("does not emit rate events without enough prior sessions", () => {
    expect(
      analyze(
        metrics({
          sessions: 40,
          sessionKeyEventRate: 0.3,
          engagementRate: 0.8,
        }),
        metrics({
          sessions: 19,
          sessionKeyEventRate: 0.1,
          engagementRate: 0.4,
        }),
      ),
    ).toEqual([]);
  });

  it("suppresses every metric when either summary report is limited", () => {
    const current = metrics({ sessions: 40, keyEvents: 4 });
    const previous = metrics({ sessions: 80, keyEvents: 10 });
    expect(
      analyze(
        current,
        previous,
        metadata({ subjectToThresholding: true, hasLimitedData: true }),
      ),
    ).toEqual([]);
    expect(
      analyze(
        current,
        previous,
        metadata(),
        metadata({
          sampling: [{ samplesReadCount: "10", samplingSpaceSize: "100" }],
          hasLimitedData: true,
        }),
      ),
    ).toEqual([]);
    expect(
      analyze(
        current,
        previous,
        metadata({ dataLossFromOtherRow: true, hasLimitedData: true }),
      ),
    ).toEqual([]);
  });

  it("skips a restricted or withheld metric without treating it as zero", () => {
    const events = analyze(
      metrics({ sessions: 40, keyEvents: null }),
      metrics({ sessions: 80, keyEvents: 10 }),
      metadata({
        restrictedMetrics: [
          { metricName: "keyEvents", restrictedMetricTypes: ["REVENUE_DATA"] },
        ],
        hasLimitedData: true,
      }),
    );

    expect(events.map((event) => event.metricKey)).toEqual(["sessions"]);
    expect(
      analyze(
        metrics({ sessions: 80, keyEvents: 0 }),
        metrics({ sessions: 80, keyEvents: null }),
      ),
    ).toEqual([]);
  });

  it("uses warning for declines, opportunity for gains, and date-range context", () => {
    const [event] = analyze(
      metrics({ sessions: 56 }),
      metrics({ sessions: 80 }),
    );

    expect(event).toMatchObject({
      eventType: "ga4.sessions.decline",
      severity: "warning",
      title: "Sessions fell 30%",
    });
    expect(event?.summary).toContain("80 → 56");
    expect(event?.summary).toContain("2026-06-11 to 2026-07-08");
    expect(event?.summary).toContain("2026-07-09 to 2026-08-05");
  });

  it("builds a deterministic dedupe key and stays within four events", () => {
    const events = analyze(
      metrics({
        sessions: 40,
        keyEvents: 4,
        sessionKeyEventRate: 0.05,
        engagementRate: 0.4,
      }),
      metrics({
        sessions: 80,
        keyEvents: 10,
        sessionKeyEventRate: 0.125,
        engagementRate: 0.6,
      }),
    );

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.dedupeKey)).toEqual([
      "ga4:2026-07-09:2026-08-05:sessions",
      "ga4:2026-07-09:2026-08-05:keyEvents",
      "ga4:2026-07-09:2026-08-05:sessionKeyEventRate",
      "ga4:2026-07-09:2026-08-05:engagementRate",
    ]);
  });
});

describe("Ga4ChangeEventService.recordDashboardChanges", () => {
  const input = {
    projectId: "project_1",
    propertyId: "properties/123",
    period,
    current: metrics({ sessions: 56 }),
    previous: metrics({ sessions: 80 }),
    currentMetadata: metadata(),
    previousMetadata: metadata(),
  };

  it("records analyzed ga4 events with a deterministic dedupe key", async () => {
    mocks.record.mockResolvedValue({ id: "event_1" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      Ga4ChangeEventService.recordDashboardChanges(input),
    ).resolves.toEqual({ recorded: 1 });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        source: "ga4",
        eventType: "ga4.sessions.decline",
        severity: "warning",
        dedupeKey: "ga4:2026-07-09:2026-08-05:sessions",
        entityType: "ga4_property",
        entityId: "properties/123",
        occurredAt: "2026-08-05T00:00:00.000Z",
      }),
    );
  });

  it("swallows write failures so the caller still succeeds", async () => {
    mocks.record.mockRejectedValue(new Error("change event write failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      Ga4ChangeEventService.recordDashboardChanges(input),
    ).resolves.toEqual({ recorded: 0 });
  });
});
