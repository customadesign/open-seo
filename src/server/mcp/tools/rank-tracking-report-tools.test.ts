import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getRankCannibalizationTool } from "./get-rank-cannibalization";
import { getRankingsDistributionTool } from "./get-rankings-distribution";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getCannibalization: vi.fn(),
  getDistribution: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/rank-tracking/services/rankTrackingReports", () => ({
  RankTrackingReportService: {
    getCannibalization: mocks.getCannibalization,
    getDistribution: mocks.getDistribution,
  },
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const trackerId = "22222222-2222-4222-8222-222222222222";
const toolContext = makeToolContext();

describe("rank tracking report MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: projectId,
      domain: "openseo.so",
      locationCode: 2840,
      languageCode: "en",
    });
  });

  it("renders cannibalization findings as a table of keywords", async () => {
    mocks.getCannibalization.mockResolvedValue({
      sameSerp: [
        {
          trackingKeywordId: "kw_1",
          keyword: "sign shop",
          device: "desktop",
          urls: [
            { url: "https://example.com/a", position: 4 },
            { url: "https://example.com/b", position: 9 },
          ],
          currentPosition: 4,
        },
      ],
      urlFlips: [],
      findings: [],
      scannedKeywords: 12,
      runCount: 8,
      capturedRunCount: 3,
      capturedSince: "2026-08-01T00:00:00.000Z",
    });

    const parsed = z
      .object(getRankCannibalizationTool.config.inputSchema)
      .parse({ projectId, trackerId });
    const result = await getRankCannibalizationTool.handler(
      parsed,
      toolContext,
    );

    expect(textContent(result)).toContain("sign shop");
    expect(textContent(result)).toContain("4");
    expect(mocks.getCannibalization).toHaveBeenCalledWith(
      trackerId,
      projectId,
      "desktop",
    );
  });

  it("renders current band counts and entered/left movement", async () => {
    mocks.getDistribution.mockResolvedValue({
      trend: [],
      current: {
        top3: 4,
        top4to10: 6,
        top11to20: 2,
        top21to100: 1,
        notInTop100: 3,
      },
      previous: null,
      movement: {
        top3: { entered: 1, left: 0 },
        top4to10: { entered: 0, left: 1 },
        top11to20: { entered: 0, left: 0 },
        top21to100: { entered: 0, left: 0 },
        notInTop100: { entered: 0, left: 0 },
      },
    });

    const parsed = z
      .object(getRankingsDistributionTool.config.inputSchema)
      .parse({ projectId, trackerId, device: "mobile" });
    const result = await getRankingsDistributionTool.handler(
      parsed,
      toolContext,
    );

    expect(textContent(result)).toContain("1–3: 4 (entered 1, left 0)");
    expect(mocks.getDistribution).toHaveBeenCalledWith(
      trackerId,
      projectId,
      "mobile",
    );
  });
});
