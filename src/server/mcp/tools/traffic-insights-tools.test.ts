import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeToolContext, textContent } from "./tool-test-support";
import { getOrganicTrafficInsightsTool } from "./traffic-insights-tools";

const mocks = vi.hoisted(() => ({
  getInsights: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock(
  "@/server/features/traffic-insights/services/OrganicTrafficInsightsService",
  () => ({
    OrganicTrafficInsightsService: { getInsights: mocks.getInsights },
  }),
);
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

const toolContext = makeToolContext();

describe("get_organic_traffic_insights", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
    mocks.getInsights.mockResolvedValue({
      range: { startDate: "2026-07-07", endDate: "2026-08-03" },
      sources: {
        ga4: { status: "connected", warnings: [], hasLimitedData: false },
        gsc: { status: "not_connected" },
        rankTracking: { status: "not_configured" },
      },
      rows: [
        {
          url: "https://example.com/blog",
          sessions: 40,
          clicks: null,
          impressions: null,
          keywordCount: null,
          bestPosition: null,
          coverage: ["ga4"],
        },
      ],
      truncated: { ga4: false, gsc: false, gscQueries: false },
    });
  });

  it("returns the joined insight rows and source statuses", async () => {
    const result = await getOrganicTrafficInsightsTool.handler(
      { projectId: "project_1", dateRange: "last_28_days" },
      toolContext,
    );

    expect(mocks.getInsights).toHaveBeenCalledWith({
      projectId: "project_1",
      dateRange: "last_28_days",
    });
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      rowCount: 1,
      sources: { gsc: { status: "not_connected" } },
    });
    expect(textContent(result)).toContain("https://example.com/blog");
    expect(textContent(result)).toContain("not_connected");
  });
});
