import { describe, expect, it } from "vitest";
import type { AiVisibilityState } from "@/server/features/ai-visibility/services/AiVisibilityService";
import type { DashboardMetricSources } from "./dashboardMetricTypes";
import { buildDashboardMetrics } from "./dashboardMetrics";

const emptyAi: AiVisibilityState = {
  configured: false,
  running: false,
  skipReason: null,
  latest: null,
  previous: null,
};

function sources(
  overrides: Partial<DashboardMetricSources> = {},
): DashboardMetricSources {
  return {
    hasDomain: true,
    aiVisibility: emptyAi,
    siteHealth: null,
    visibility: null,
    domainOverview: null,
    backlinks: null,
    ...overrides,
  };
}

const byKey = (input: DashboardMetricSources) =>
  new Map(buildDashboardMetrics(input).map((metric) => [metric.key, metric]));

describe("buildDashboardMetrics", () => {
  it("returns the seven cards in a fixed order", () => {
    expect(
      buildDashboardMetrics(sources()).map((metric) => metric.key),
    ).toEqual([
      "ai_visibility",
      "mentions",
      "site_health",
      "visibility",
      "organic_traffic",
      "organic_keywords",
      "backlinks",
    ]);
  });

  it("never reports missing data as zero", () => {
    for (const metric of buildDashboardMetrics(sources({ hasDomain: false }))) {
      expect(metric.value).toBeNull();
      expect(metric.delta).toBeNull();
      expect(metric.status).not.toBe("ready");
      expect(metric.note).not.toBeNull();
    }
  });

  it("asks for setup on the metrics a user has to start", () => {
    const metrics = byKey(sources({ hasDomain: false }));
    expect(metrics.get("site_health")?.status).toBe("setup");
    expect(metrics.get("visibility")?.status).toBe("setup");
    expect(metrics.get("organic_traffic")?.target).toBe("settings");
  });

  it("routes a plan block to an unavailable state, not a zero or a retry", () => {
    const metrics = byKey(
      sources({
        aiVisibility: {
          ...emptyAi,
          configured: true,
          skipReason: "plan_required",
        },
      }),
    );
    expect(metrics.get("ai_visibility")?.status).toBe("unavailable");
    expect(metrics.get("ai_visibility")?.target).toBe("billing");
    expect(metrics.get("mentions")?.status).toBe("unavailable");
  });

  it("reads as collecting while the first AI baseline is in flight", () => {
    const metrics = byKey(
      sources({
        aiVisibility: { ...emptyAi, configured: true, running: true },
      }),
    );
    expect(metrics.get("ai_visibility")?.status).toBe("collecting");
    expect(metrics.get("mentions")?.status).toBe("collecting");
  });

  it("reports AI visibility in percentage points and mentions as a count", () => {
    const metrics = byKey(
      sources({
        aiVisibility: {
          configured: true,
          running: false,
          skipReason: null,
          latest: {
            capturedAt: "2026-08-18T00:00:00.000Z",
            summary: {
              visibilityPercent: 50,
              mentions: 6,
              readableObservations: 4,
              unavailableObservations: 0,
            },
          },
          previous: {
            summary: {
              visibilityPercent: 25,
              mentions: 2,
              readableObservations: 4,
              unavailableObservations: 0,
            },
          },
        },
      }),
    );

    expect(metrics.get("ai_visibility")).toMatchObject({
      value: 50,
      delta: 25,
      deltaKind: "percentage_points",
      status: "ready",
    });
    expect(metrics.get("mentions")).toMatchObject({
      value: 6,
      delta: 4,
      deltaKind: "absolute",
    });
  });

  it("reports a total AI provider outage as unavailable", () => {
    const metrics = byKey(
      sources({
        aiVisibility: {
          ...emptyAi,
          configured: true,
          latest: {
            capturedAt: "2026-08-18T00:00:00.000Z",
            summary: {
              visibilityPercent: null,
              mentions: 0,
              readableObservations: 0,
              unavailableObservations: 3,
            },
          },
        },
      }),
    );
    expect(metrics.get("ai_visibility")?.status).toBe("unavailable");
    expect(metrics.get("ai_visibility")?.value).toBeNull();
  });

  it("labels domain overview numbers as estimates and traffic delta as a percent", () => {
    const metrics = byKey(
      sources({
        domainOverview: {
          organicTraffic: 1200,
          organicKeywords: 340,
          previousOrganicTraffic: 1000,
          previousOrganicKeywords: 300,
          capturedAt: "2026-08-18T00:00:00.000Z",
        },
      }),
    );

    expect(metrics.get("organic_traffic")).toMatchObject({
      value: 1200,
      delta: 20,
      deltaKind: "percent",
      estimated: true,
      status: "ready",
    });
    expect(metrics.get("organic_keywords")).toMatchObject({
      value: 340,
      delta: 40,
      deltaKind: "absolute",
    });
  });

  it("keeps a completed-but-empty audit out of the ready state", () => {
    const metrics = byKey(
      sources({
        siteHealth: {
          score: null,
          previousScore: null,
          pagesCrawled: 0,
          capturedAt: "2026-08-18T00:00:00.000Z",
        },
      }),
    );
    expect(metrics.get("site_health")?.status).toBe("unavailable");
    expect(metrics.get("site_health")?.value).toBeNull();
  });

  it("waits for search volume before scoring visibility", () => {
    const metrics = byKey(
      sources({
        visibility: {
          current: null,
          previous: null,
          trackedKeywords: 12,
          capturedAt: "2026-08-18T00:00:00.000Z",
        },
      }),
    );
    expect(metrics.get("visibility")?.status).toBe("collecting");
  });
});
