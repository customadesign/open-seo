import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBacklinkGapService } from "./BacklinkGapService";
import type { ReferringDomainsSnapshot } from "@/server/features/backlinks/services/backlinksSnapshot";

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
  listReferringDomains: vi.fn(),
  listLinks: vi.fn(),
}));

const billing = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "alice@example.com",
};

function snapshot(
  domain: string,
  rows: Array<{
    domain: string;
    rank: number | null;
    firstSeen: string | null;
  }>,
): ReferringDomainsSnapshot {
  return {
    domain,
    fetchedAt: "2026-08-18T00:00:00.000Z",
    fromCache: false,
    rows: rows.map((row) => ({
      domain: row.domain,
      backlinks: 4,
      referringPages: 2,
      rank: row.rank,
      spamScore: 1,
      firstSeen: row.firstSeen,
      brokenBacklinks: 0,
      brokenPages: 0,
    })),
  };
}

const service = createBacklinkGapService({
  getSnapshot: mocks.getSnapshot,
  hasSnapshot: mocks.hasSnapshot,
  repo: {
    findFreshRun: mocks.findFreshRun,
    replaceRun: mocks.replaceRun,
    getRun: mocks.getRun,
    listDomains: mocks.listDomains,
    listReferringDomains: mocks.listReferringDomains,
    listLinks: mocks.listLinks,
  },
});

const compareInput = {
  projectId: "11111111-1111-1111-1111-111111111111",
  baseDomain: "example.com",
  competitorDomains: ["ahrefs.com", "semrush.com"],
};

describe("BacklinkGapService", () => {
  beforeEach(() => {
    mocks.hasSnapshot.mockResolvedValue(false);
    mocks.findFreshRun.mockResolvedValue(null);
    mocks.replaceRun.mockResolvedValue(undefined);
    mocks.getRun.mockResolvedValue({
      id: "run_1",
      fetchedAt: "2026-08-18T00:00:00.000Z",
    });
    mocks.listDomains.mockResolvedValue([
      { domain: "example.com", role: "base", sortOrder: 0 },
      { domain: "ahrefs.com", role: "competitor", sortOrder: 1 },
      { domain: "semrush.com", role: "competitor", sortOrder: 2 },
    ]);
    mocks.listReferringDomains.mockResolvedValue([]);
    mocks.listLinks.mockResolvedValue([]);
  });

  it("persists only referring domains that skip the base domain", async () => {
    mocks.getSnapshot
      .mockResolvedValueOnce(
        snapshot("example.com", [
          { domain: "shared.example", rank: 70, firstSeen: "2024-01-01" },
        ]),
      )
      .mockResolvedValueOnce(
        snapshot("ahrefs.com", [
          { domain: "shared.example", rank: 80, firstSeen: "2023-01-01" },
          { domain: "gap.example", rank: 55, firstSeen: "2025-02-01" },
        ]),
      )
      .mockResolvedValueOnce(
        snapshot("semrush.com", [
          { domain: "gap.example", rank: 40, firstSeen: "2025-01-01" },
        ]),
      );

    await service.run({ ...compareInput, maxCostCredits: 10_000 }, billing);

    expect(mocks.replaceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        referringDomains: [
          expect.objectContaining({
            referringDomain: "gap.example",
            competitorCount: 2,
            firstSeen: "2025-01-01",
          }),
        ],
      }),
    );
  });
});
