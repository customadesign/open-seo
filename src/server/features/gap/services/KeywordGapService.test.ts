import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { createKeywordGapService } from "./KeywordGapService";
import type { KeywordSnapshot } from "@/server/features/domain/services/domainKeywordsPage";

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
  env: {},
}));

vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: vi.fn(async () => "cache-key"),
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  hasSnapshot: vi.fn(),
  findFreshRun: vi.fn(),
  replaceRun: vi.fn(),
  getRun: vi.fn(),
  listDomains: vi.fn(),
  listKeywords: vi.fn(),
  listPositions: vi.fn(),
}));

const billing = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "alice@example.com",
};

function snapshot(
  domain: string,
  keywords: Array<{ keyword: string; position: number | null }>,
): KeywordSnapshot {
  return {
    domain,
    fetchedAt: "2026-08-18T00:00:00.000Z",
    fromCache: false,
    keywords: keywords.map((item) => ({
      keyword: item.keyword,
      position: item.position,
      searchVolume: 100,
      traffic: null,
      cpc: 1,
      url: null,
      relativeUrl: null,
      keywordDifficulty: 20,
      intent: "informational",
    })),
  };
}

const service = createKeywordGapService({
  getSnapshot: mocks.getSnapshot,
  hasSnapshot: mocks.hasSnapshot,
  repo: {
    findFreshRun: mocks.findFreshRun,
    replaceRun: mocks.replaceRun,
    getRun: mocks.getRun,
    listDomains: mocks.listDomains,
    listKeywords: mocks.listKeywords,
    listPositions: mocks.listPositions,
  },
});

const compareInput = {
  projectId: "11111111-1111-1111-1111-111111111111",
  baseDomain: "example.com",
  competitorDomains: ["ahrefs.com", "semrush.com"],
  includeSubdomains: true,
  locationCode: 2840,
  languageCode: "en",
};

describe("KeywordGapService", () => {
  beforeEach(() => {
    mocks.hasSnapshot.mockResolvedValue(false);
    mocks.findFreshRun.mockResolvedValue(null);
    mocks.replaceRun.mockResolvedValue(undefined);
    mocks.getRun.mockResolvedValue({
      id: "run_1",
      locationCode: 2840,
      languageCode: "en",
      includeSubdomains: true,
      fetchedAt: "2026-08-18T00:00:00.000Z",
    });
    mocks.listDomains.mockResolvedValue([
      { domain: "example.com", role: "base", sortOrder: 0 },
      { domain: "ahrefs.com", role: "competitor", sortOrder: 1 },
      { domain: "semrush.com", role: "competitor", sortOrder: 2 },
    ]);
    mocks.listKeywords.mockResolvedValue([]);
    mocks.listPositions.mockResolvedValue([]);
  });

  it("does not fetch snapshots when a fresh comparison already exists", async () => {
    mocks.findFreshRun.mockResolvedValue({ id: "run_1" });

    await service.run(compareInput, billing);

    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.replaceRun).not.toHaveBeenCalled();
  });

  it("rejects a billed run when the approved credit ceiling is too low", async () => {
    await expect(
      service.run({ ...compareInput, maxCostCredits: 1 }, billing),
    ).rejects.toBeInstanceOf(AppError);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it("classifies the union of snapshots before persisting", async () => {
    mocks.getSnapshot
      .mockResolvedValueOnce(
        snapshot("example.com", [{ keyword: "seo audit", position: 12 }]),
      )
      .mockResolvedValueOnce(
        snapshot("ahrefs.com", [{ keyword: "seo audit", position: 3 }]),
      )
      .mockResolvedValueOnce(
        snapshot("semrush.com", [{ keyword: "seo audit", position: 4 }]),
      );

    await service.run({ ...compareInput, maxCostCredits: 10_000 }, billing);

    expect(mocks.replaceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: [
          expect.objectContaining({
            keyword: "seo audit",
            classification: "weak",
          }),
        ],
      }),
    );
  });
});
