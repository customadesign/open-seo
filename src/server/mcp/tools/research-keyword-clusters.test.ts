import { beforeEach, describe, expect, it, vi } from "vitest";
import { researchKeywordClustersTool } from "./research-keyword-clusters";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  estimateKeywordMagic: vi.fn(),
  runKeywordMagic: vi.fn(),
  getKeywordMagicPage: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/keywords/services/KeywordResearchService", () => ({
  KeywordResearchService: {
    estimateKeywordMagic: mocks.estimateKeywordMagic,
    runKeywordMagic: mocks.runKeywordMagic,
    getKeywordMagicPage: mocks.getKeywordMagicPage,
  },
}));

const toolContext = makeToolContext();

describe("research_keyword_clusters", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.estimateKeywordMagic.mockResolvedValue({
      cached: false,
      runId: null,
      requests: 3,
      costUsd: 0.08,
      costCredits: 80,
      provider: "labs",
      maxKeywords: 1000,
    });
    mocks.runKeywordMagic.mockResolvedValue({
      id: "run_1",
      seed: "crm software",
      locationCode: 2840,
      languageCode: "en",
      clickstream: false,
      maxKeywords: 1000,
      keywordCount: 12,
      provider: "labs",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });
    mocks.getKeywordMagicPage.mockResolvedValue({
      run: { id: "run_1", seed: "crm software", keywordCount: 12 },
      clusters: [{ id: "c1", name: "Crm Software", keywordCount: 8 }],
      rows: [
        {
          keyword: "crm software",
          searchVolume: 2400,
          keywordDifficulty: 40,
          cpc: 3.1,
        },
      ],
      matchType: "all",
    });
  });

  it("requires maxCostCredits before a billed seed run", async () => {
    await expect(
      researchKeywordClustersTool.handler(
        { projectId: "project_1", seed: "crm software" },
        toolContext,
      ),
    ).rejects.toThrow(/80 credits/);
    expect(mocks.runKeywordMagic).not.toHaveBeenCalled();
  });

  it("runs a billed seed when maxCostCredits is supplied", async () => {
    const result = await researchKeywordClustersTool.handler(
      {
        projectId: "project_1",
        seed: "crm software",
        maxCostCredits: 80,
      },
      toolContext,
    );

    expect(mocks.runKeywordMagic).toHaveBeenCalledWith(
      expect.objectContaining({ maxCostCredits: 80, seed: "crm software" }),
      expect.anything(),
    );
    expect(textContent(result)).toContain("Crm Software");
    expect(result.structuredContent).toMatchObject({
      runId: "run_1",
      keywordCount: 12,
    });
  });
});
