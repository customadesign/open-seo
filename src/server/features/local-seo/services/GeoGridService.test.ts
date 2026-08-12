import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateGeoGridRanks,
  computeNextGeoGridRun,
  GeoGridService,
  matchLocalBusinessResult,
  planGeoGrid,
} from "./GeoGridService";

const repositoryMocks = vi.hoisted(() => ({
  getGeoGridConfig: vi.fn(),
  getActiveGeoGridRun: vi.fn(),
  failStaleGeoGridRun: vi.fn(),
  getProfileById: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/runBatch", () => ({
  executeInBatches: vi.fn(),
  runBatch: vi.fn(),
}));
vi.mock("@/server/features/local-seo/repositories/LocalSeoRepository", () => ({
  LocalSeoRepository: repositoryMocks,
}));

describe("computeNextGeoGridRun", () => {
  it("keeps daily and weekly schedules on their UTC anchor", () => {
    expect(computeNextGeoGridRun("daily", "2026-08-13T04:30:00.000Z")).toBe(
      "2026-08-14T04:30:00.000Z",
    );
    expect(computeNextGeoGridRun("weekly", "2026-08-13T04:30:00.000Z")).toBe(
      "2026-08-20T04:30:00.000Z",
    );
  });

  it("clamps month-end schedules instead of skipping February", () => {
    expect(computeNextGeoGridRun("monthly", "2027-01-31T04:30:00.000Z")).toBe(
      "2027-02-28T04:30:00.000Z",
    );
  });
});

describe("stale geo-grid recovery", () => {
  const config = {
    id: "config-1",
    projectId: "project-1",
    profileId: "profile-1",
  };
  const billingCustomer = {
    organizationId: "organization-1",
    userEmail: "owner@example.com",
    userId: "user-1",
    projectId: config.projectId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.getGeoGridConfig.mockResolvedValue(config);
  });

  it("returns a recent active run without releasing it", async () => {
    const activeRun = {
      id: "run-1",
      status: "running",
      startedAt: new Date(Date.now() - 5 * 60 * 1_000).toISOString(),
    };
    repositoryMocks.getActiveGeoGridRun.mockResolvedValue(activeRun);

    await expect(
      GeoGridService.runGrid({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer,
      }),
    ).resolves.toEqual({ started: false, run: activeRun });
    expect(repositoryMocks.failStaleGeoGridRun).not.toHaveBeenCalled();
  });

  it("releases an active run after the recovery window before retrying", async () => {
    const activeRun = {
      id: "run-stale",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1_000).toISOString(),
    };
    repositoryMocks.getActiveGeoGridRun.mockResolvedValue(activeRun);
    repositoryMocks.failStaleGeoGridRun.mockResolvedValue({
      ...activeRun,
      status: "failed",
    });
    repositoryMocks.getProfileById.mockResolvedValue(null);

    await expect(
      GeoGridService.runGrid({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repositoryMocks.failStaleGeoGridRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: activeRun.id,
        projectId: config.projectId,
        observedStartedAt: activeRun.startedAt,
      }),
    );
  });
});

const target = {
  name: "Murphy Consulting LLC",
  phone: "+1 (214) 555-0100",
  websiteUrl: "https://www.murphy.example/services",
  googlePlaceId: "ChIJ-place",
  googleCid: "123456789",
};

describe("planGeoGrid", () => {
  it("creates a stable odd square centered exactly on the configured point", () => {
    const cells = planGeoGrid({
      centerLatitude: 32.7767,
      centerLongitude: -96.797,
      gridSize: 5,
      radiusMeters: 5_000,
    });

    expect(cells).toHaveLength(25);
    expect(cells[12]).toEqual({
      rowIndex: 2,
      columnIndex: 2,
      latitude: 32.7767,
      longitude: -96.797,
    });
    expect(cells[0].latitude).toBeGreaterThan(cells[20].latitude);
    expect(cells[0].longitude).toBeLessThan(cells[4].longitude);
    expect(new Set(cells.map((cell) => cell.latitude))).toHaveLength(5);
    expect(new Set(cells.map((cell) => cell.longitude))).toHaveLength(5);
  });
});

describe("aggregateGeoGridRanks", () => {
  it("uses every checked cell as the coverage denominator and ranked cells for average rank", () => {
    expect(
      aggregateGeoGridRanks([
        { position: 1 },
        { position: 3 },
        { position: 9 },
        { position: 18 },
        { position: null },
      ]),
    ).toEqual({
      cellsTotal: 5,
      cellsRanked: 4,
      averageRank: 7.75,
      topThreeCoverage: 0.4,
      topTenCoverage: 0.6,
      topTwentyCoverage: 0.8,
    });
  });

  it("reports honest null rank and zero coverage for an empty or unranked grid", () => {
    expect(aggregateGeoGridRanks([])).toEqual({
      cellsTotal: 0,
      cellsRanked: 0,
      averageRank: null,
      topThreeCoverage: 0,
      topTenCoverage: 0,
      topTwentyCoverage: 0,
    });
    expect(aggregateGeoGridRanks([{ position: null }]).averageRank).toBeNull();
  });
});

describe("matchLocalBusinessResult", () => {
  it("uses the strongest identifier even when a weaker match appears first", () => {
    const match = matchLocalBusinessResult(target, [
      {
        title: "Murphy Consulting LLC",
        domain: "murphy.example",
        phone: "+1 (214) 555-0100",
        rank_group: 1,
      },
      {
        title: "Murphy Consulting",
        place_id: "ChIJ-place",
        cid: "123456789",
        rank_group: 7,
        url: "https://maps.google.test/place",
      },
    ]);

    expect(match).toMatchObject({ matchedBy: "place_id", position: 7 });
  });

  it.each([
    [{ googlePlaceId: null }, { cid: "123456789", rank_absolute: 2 }, "cid"],
    [
      { googlePlaceId: null, googleCid: null },
      { phone: "214.555.0100", rank_absolute: 3 },
      "phone",
    ],
    [
      { googlePlaceId: null, googleCid: null, phone: "999" },
      { domain: "www.murphy.example", rank_absolute: 4 },
      "domain",
    ],
    [
      {
        googlePlaceId: null,
        googleCid: null,
        phone: "999",
        websiteUrl: "https://other.example",
      },
      { title: "Murphy Consulting, Inc.", rank_absolute: 5 },
      "name",
    ],
  ] as const)(
    "falls back through the identifier hierarchy",
    (override, row, expected) => {
      expect(
        matchLocalBusinessResult({ ...target, ...override }, [row]).matchedBy,
      ).toBe(expected);
    },
  );

  it("does not infer a ranking when no supported evidence matches", () => {
    expect(
      matchLocalBusinessResult(target, [
        { title: "Different Business", rank_group: 1 },
      ]),
    ).toEqual({
      matchedBy: "none",
      position: null,
      resultTitle: null,
      resultUrl: null,
      providerResultId: null,
    });
  });
});
