import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeGa4ReportResult } from "@/server/features/ga4/services/ga4-test-fixtures";
import { OrganicTrafficInsightsService } from "./OrganicTrafficInsightsService";

const mocks = vi.hoisted(() => ({
  getGa4Connection: vi.fn(),
  getGscConnection: vi.fn(),
  getPerformance: vi.fn(),
  runGa4Report: vi.fn(),
  getConfigsForProject: vi.fn(),
  getLatestSnapshotsForKeywords: vi.fn(),
}));

vi.mock("@/server/features/ga4/repositories/Ga4ConnectionRepository", () => ({
  Ga4ConnectionRepository: { getByProjectId: mocks.getGa4Connection },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {
    getConnection: mocks.getGscConnection,
    getPerformance: mocks.getPerformance,
  },
  isExpectedGrantFailure: () => false,
}));
vi.mock("@/server/features/ga4/services/Ga4ReportingService", () => ({
  Ga4ReportingService: { runReport: mocks.runGa4Report },
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({
    RankTrackingRepository: {
      getConfigsForProject: mocks.getConfigsForProject,
      getLatestSnapshotsForKeywords: mocks.getLatestSnapshotsForKeywords,
    },
  }),
);

const ga4Result = makeGa4ReportResult({
  rows: [
    {
      hostName: "www.example.com",
      landingPage: "/High-Value/?utm_source=x",
      sessions: 100,
      engagementRate: 0.8,
      keyEvents: 10,
    },
  ],
  rowCount: 1,
  totalRowCount: 1,
});

describe("OrganicTrafficInsightsService", () => {
  beforeEach(() => {
    mocks.getGa4Connection.mockResolvedValue({
      propertyTimeZone: "America/New_York",
    });
    mocks.getGscConnection.mockResolvedValue({
      siteUrl: "https://example.com/",
    });
    mocks.runGa4Report.mockResolvedValue(ga4Result);
    mocks.getConfigsForProject.mockResolvedValue([{ id: "config_1" }]);
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([
      {
        keyword: "high value software",
        url: "https://EXAMPLE.com/High-Value/",
        position: 4,
        device: "desktop",
      },
    ]);
    mocks.getPerformance.mockImplementation(
      async (input: { dimensions?: string[] }) => {
        const dimensions = input.dimensions ?? [];
        if (dimensions[0] === "page" && dimensions[1] === "query") {
          return {
            siteUrl: "https://example.com/",
            rows: [
              {
                keys: ["https://example.com/High-Value", "high value software"],
                clicks: 12,
                impressions: 400,
                ctr: 0.03,
                position: 5.2,
              },
            ],
          };
        }
        return {
          siteUrl: "https://example.com/",
          rows: [
            {
              keys: ["https://example.com/High-Value"],
              clicks: 20,
              impressions: 800,
              ctr: 0.025,
              position: 6.1,
            },
            {
              keys: ["https://example.com/gsc-only"],
              clicks: 3,
              impressions: 90,
              ctr: 0.033,
              position: 14,
            },
          ],
        };
      },
    );
  });

  it("joins GA4, GSC, and rank snapshots on the normalized page key", async () => {
    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    const joined = result.rows.find(
      (row) => row.key === "example.com/High-Value",
    );
    expect(joined?.coverage.toSorted()).toEqual([
      "ga4",
      "gsc",
      "rank_tracking",
    ]);
    expect(joined).toMatchObject({
      sessions: 100,
      clicks: 20,
      keywordCount: 1,
      bestPosition: 4,
    });
    expect(joined?.queries[0]?.query).toBe("high value software");
  });

  it("leaves missing-source metrics null instead of zero", async () => {
    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    const gscOnly = result.rows.find(
      (row) => row.key === "example.com/gsc-only",
    );
    expect(gscOnly).toMatchObject({
      coverage: ["gsc"],
      sessions: null,
      engagementRate: null,
      keyEvents: null,
      clicks: 3,
      keywordCount: 0,
      bestPosition: null,
    });
  });

  it("skips GA4 and GSC API calls when those products are not connected", async () => {
    mocks.getGa4Connection.mockResolvedValue(null);
    mocks.getGscConnection.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);

    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      dateRange: "last_28_days",
    });

    expect(mocks.runGa4Report).not.toHaveBeenCalled();
    expect(mocks.getPerformance).not.toHaveBeenCalled();
    expect(result.sources.ga4.status).toBe("not_connected");
    expect(result.sources.gsc.status).toBe("not_connected");
    expect(result.sources.rankTracking.status).toBe("not_configured");
    expect(result.rows).toEqual([]);
  });

  it("surfaces GA4 limited-data metadata without inventing metric values", async () => {
    mocks.runGa4Report.mockResolvedValue(
      makeGa4ReportResult({
        rows: [
          {
            hostName: "example.com",
            landingPage: "/sampled",
            sessions: 40,
            engagementRate: null,
            keyEvents: null,
          },
        ],
        rowCount: 1,
        totalRowCount: 1,
        warnings: ["sampled"],
        reportMetadata: {
          dataLossFromOtherRow: false,
          subjectToThresholding: true,
          sampling: [{ samplesReadCount: "10", samplingSpaceSize: "100" }],
          restrictedMetrics: [
            {
              metricName: "keyEvents",
              restrictedMetricTypes: ["THRESHOLDING"],
            },
          ],
          emptyReason: null,
          hasLimitedData: true,
        },
      }),
    );

    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    expect(result.sources.ga4.hasLimitedData).toBe(true);
    expect(result.sources.ga4.warnings).toContain("sampled");
    expect(
      result.rows.find((row) => row.key === "example.com/sampled"),
    ).toMatchObject({
      sessions: 40,
      engagementRate: null,
      keyEvents: null,
    });
  });

  it("joins a GSC page onto a GA4 page when only the path casing differs", async () => {
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.runGa4Report.mockResolvedValue(
      makeGa4ReportResult({
        rows: [
          {
            hostName: "example.com",
            landingPage: "/High-Value",
            sessions: 50,
            engagementRate: 0.6,
            keyEvents: 3,
          },
        ],
        rowCount: 1,
        totalRowCount: 1,
      }),
    );
    mocks.getPerformance.mockImplementation(
      async (input: { dimensions?: string[] }) => {
        if (input.dimensions?.[1] === "query") {
          return { siteUrl: "https://example.com/", rows: [] };
        }
        return {
          siteUrl: "https://example.com/",
          rows: [
            {
              keys: ["https://example.com/high-value"],
              clicks: 8,
              impressions: 80,
              ctr: 0.1,
              position: 9,
            },
          ],
        };
      },
    );

    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      key: "example.com/High-Value",
      sessions: 50,
      clicks: 8,
    });
  });

  it("keeps path-case variants as separate pages", async () => {
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.runGa4Report.mockResolvedValue(
      makeGa4ReportResult({
        rows: [
          {
            hostName: "example.com",
            landingPage: "/Services",
            sessions: 10,
            engagementRate: 0.5,
            keyEvents: 1,
          },
          {
            hostName: "example.com",
            landingPage: "/services",
            sessions: 20,
            engagementRate: 0.4,
            keyEvents: 2,
          },
        ],
        rowCount: 2,
        totalRowCount: 2,
      }),
    );
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "https://example.com/",
      rows: [],
    });

    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    expect(result.rows.map((row) => row.key).toSorted()).toEqual([
      "example.com/Services",
      "example.com/services",
    ]);
    expect(
      result.rows.find((row) => row.key === "example.com/Services")?.sessions,
    ).toBe(10);
    expect(
      result.rows.find((row) => row.key === "example.com/services")?.sessions,
    ).toBe(20);
  });

  it("groups query-string variants onto one path row and sums their metrics", async () => {
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.runGa4Report.mockResolvedValue(
      makeGa4ReportResult({ rows: [], rowCount: 0, totalRowCount: 0 }),
    );
    mocks.getPerformance.mockImplementation(
      async (input: { dimensions?: string[] }) => {
        const dimensions = input.dimensions ?? [];
        if (dimensions[0] === "page" && dimensions[1] === "query") {
          return { siteUrl: "https://example.com/", rows: [] };
        }
        return {
          siteUrl: "https://example.com/",
          rows: [
            {
              keys: ["https://example.com/product?product_id=1"],
              clicks: 4,
              impressions: 40,
              ctr: 0.1,
              position: 5,
            },
            {
              keys: ["https://example.com/product?product_id=2"],
              clicks: 6,
              impressions: 60,
              ctr: 0.1,
              position: 7,
            },
          ],
        };
      },
    );

    const result = await OrganicTrafficInsightsService.getInsights({
      projectId: "project_1",
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      key: "example.com/product",
      clicks: 10,
      impressions: 100,
    });
  });
});
