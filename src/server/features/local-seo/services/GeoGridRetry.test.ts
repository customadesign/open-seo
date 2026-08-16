import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeoGridService, planGeoGrid } from "./GeoGridService";

const repositoryMocks = vi.hoisted(() => ({
  getGeoGridConfig: vi.fn(),
  getActiveGeoGridRun: vi.fn(),
  failStaleGeoGridRun: vi.fn(),
  getProfileById: vi.fn(),
  getLatestFailedGeoGridRun: vi.fn(),
  getGeoGridRun: vi.fn(),
  getGeoGridCells: vi.fn(),
  claimFailedGeoGridRun: vi.fn(),
  createGeoGridRun: vi.fn(),
  insertGeoGridCellClaimed: vi.fn(),
  updateGeoGridRun: vi.fn(),
  markGeoGridConfigRun: vi.fn(),
}));
const localSearchMock = vi.hoisted(() => vi.fn());

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/runBatch", () => ({
  executeInBatches: vi.fn(),
  runBatch: vi.fn(),
}));
vi.mock("@/server/features/local-seo/repositories/LocalSeoRepository", () => ({
  LocalSeoRepository: repositoryMocks,
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({ serp: { local: localSearchMock } }),
}));

const configId = "config-1";
const projectId = "project-1";
const billingCustomer = {
  organizationId: "organization-1",
  userEmail: "owner@example.com",
  userId: "user-1",
  projectId,
};

function setupRetryFixture(input?: {
  failedStartedAt?: string;
  failedCompletedAt?: string;
  profileUpdatedAt?: string;
}) {
  const now = Date.now();
  const startedAt =
    input?.failedStartedAt ?? new Date(now - 5 * 60 * 1_000).toISOString();
  const config = {
    id: configId,
    projectId,
    profileId: "profile-1",
    keyword: "sign shop",
    centerLatitude: 33.1294592,
    centerLongitude: -117.1201598,
    gridSize: 3,
    radiusMeters: 1_500,
    languageCode: "en",
    device: "desktop" as const,
    updatedAt: new Date(now - 10 * 60 * 1_000).toISOString(),
  };
  const failedRun = {
    id: "run-failed",
    configId,
    projectId,
    status: "failed",
    attemptToken: "attempt-old",
    attemptStartedAt: startedAt,
    startedAt,
    completedAt:
      input?.failedCompletedAt ?? new Date(now - 60_000).toISOString(),
    gridSize: 3,
    radiusMeters: 1_500,
    cellsTotal: 9,
  };
  const freshRun = {
    ...failedRun,
    id: "run-fresh",
    status: "running",
    attemptToken: "attempt-fresh",
    attemptStartedAt: new Date(now).toISOString(),
    startedAt: new Date(now).toISOString(),
    completedAt: null,
  };
  const plan = planGeoGrid(config);

  repositoryMocks.getGeoGridConfig.mockResolvedValue(config);
  repositoryMocks.getActiveGeoGridRun.mockResolvedValue(null);
  repositoryMocks.getProfileById.mockResolvedValue({
    name: "All Star Signs, Inc",
    phone: "760-555-0100",
    websiteUrl: "https://allstarsignsinc.com",
    googlePlaceId: "place-1",
    googleCid: "cid-1",
    updatedAt:
      input?.profileUpdatedAt ?? new Date(now - 10 * 60 * 1_000).toISOString(),
  });
  repositoryMocks.getLatestFailedGeoGridRun.mockResolvedValue(failedRun);
  repositoryMocks.getGeoGridRun.mockResolvedValue(freshRun);
  repositoryMocks.createGeoGridRun.mockResolvedValue(freshRun);
  repositoryMocks.insertGeoGridCellClaimed.mockResolvedValue({ id: "cell" });
  repositoryMocks.updateGeoGridRun.mockResolvedValue(freshRun);
  repositoryMocks.markGeoGridConfigRun.mockResolvedValue(undefined);
  localSearchMock.mockResolvedValue([]);
  return { failedRun, freshRun, plan, now };
}

async function runGrid() {
  return GeoGridService.runGrid({ configId, projectId, billingCustomer });
}

describe("geo-grid paid-cell retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes one recent failed run and preserves stored cell evidence", async () => {
    const { failedRun, plan, now } = setupRetryFixture();
    const checkedAt = new Date(now - 4 * 60 * 1_000).toISOString();
    repositoryMocks.getGeoGridCells.mockResolvedValue([
      {
        ...plan[0],
        latitude: Math.fround(plan[0].latitude),
        longitude: Math.fround(plan[0].longitude),
        position: 7,
        matchedBy: "place_id",
        resultTitle: "All Star Signs, Inc",
        resultUrl: "https://maps.google.test/all-star",
        providerResultId: "place-1",
        checkedAt,
      },
    ]);
    repositoryMocks.claimFailedGeoGridRun.mockResolvedValue({
      ...failedRun,
      status: "running",
      attemptToken: "attempt-retry",
      attemptStartedAt: new Date(now).toISOString(),
    });
    repositoryMocks.getGeoGridRun.mockResolvedValue({
      ...failedRun,
      status: "running",
      attemptToken: "attempt-retry",
      attemptStartedAt: new Date(now).toISOString(),
    });
    repositoryMocks.updateGeoGridRun.mockResolvedValue({
      ...failedRun,
      status: "completed",
      attemptToken: "attempt-retry",
    });
    localSearchMock.mockResolvedValue([
      { place_id: "place-1", rank_group: 2, title: "All Star Signs, Inc" },
    ]);

    const result = await runGrid();

    expect(result.started).toBe(true);
    if (!result.started) throw new Error("Expected the failed run to resume");
    expect(result.run?.id).toBe("run-failed");
    expect(result.cells).toHaveLength(9);
    expect(result.cells[0]).toMatchObject({ checkedAt, position: 7 });
    expect(localSearchMock).toHaveBeenCalledTimes(8);
    expect(repositoryMocks.claimFailedGeoGridRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-failed",
        observedCompletedAt: failedRun.completedAt,
        observedAttemptToken: "attempt-old",
      }),
    );
    expect(repositoryMocks.createGeoGridRun).not.toHaveBeenCalled();
    expect(repositoryMocks.insertGeoGridCellClaimed).toHaveBeenCalledTimes(8);
  });

  it("starts a fresh run after the retry window expires", async () => {
    const now = Date.now();
    setupRetryFixture({
      failedStartedAt: new Date(now - 2 * 60 * 60 * 1_000).toISOString(),
      failedCompletedAt: new Date(now - 60_000).toISOString(),
      profileUpdatedAt: new Date(now - 3 * 60 * 60 * 1_000).toISOString(),
    });

    await runGrid();

    expect(repositoryMocks.claimFailedGeoGridRun).not.toHaveBeenCalled();
    expect(repositoryMocks.createGeoGridRun).toHaveBeenCalledTimes(1);
    expect(localSearchMock).toHaveBeenCalledTimes(9);
  });

  it("starts a fresh run when the matching profile changed", async () => {
    setupRetryFixture({ profileUpdatedAt: new Date().toISOString() });

    await runGrid();

    expect(repositoryMocks.claimFailedGeoGridRun).not.toHaveBeenCalled();
    expect(repositoryMocks.createGeoGridRun).toHaveBeenCalledTimes(1);
    expect(localSearchMock).toHaveBeenCalledTimes(9);
  });

  it("does not create a new run when the concurrent retry already completed", async () => {
    const { failedRun, plan, now } = setupRetryFixture();
    const winningRun = { ...failedRun, status: "completed" };
    repositoryMocks.getGeoGridCells.mockResolvedValue([
      {
        ...plan[0],
        position: 7,
        matchedBy: "place_id",
        resultTitle: "All Star Signs, Inc",
        resultUrl: null,
        providerResultId: "place-1",
        checkedAt: new Date(now - 4 * 60 * 1_000).toISOString(),
      },
    ]);
    repositoryMocks.claimFailedGeoGridRun.mockResolvedValue(null);
    repositoryMocks.getGeoGridRun.mockResolvedValue(winningRun);

    await expect(runGrid()).resolves.toEqual({
      started: false,
      run: winningRun,
    });
    expect(repositoryMocks.createGeoGridRun).not.toHaveBeenCalled();
    expect(localSearchMock).not.toHaveBeenCalled();
  });

  it("stops before another paid call when its attempt lease is lost", async () => {
    const { failedRun, plan, now } = setupRetryFixture();
    repositoryMocks.getGeoGridCells.mockResolvedValue([
      {
        ...plan[0],
        position: 7,
        matchedBy: "place_id",
        resultTitle: "All Star Signs, Inc",
        resultUrl: null,
        providerResultId: "place-1",
        checkedAt: new Date(now - 4 * 60 * 1_000).toISOString(),
      },
    ]);
    repositoryMocks.claimFailedGeoGridRun.mockResolvedValue({
      ...failedRun,
      status: "running",
      attemptToken: "attempt-retry",
      attemptStartedAt: new Date(now).toISOString(),
    });
    repositoryMocks.updateGeoGridRun.mockResolvedValue(null);

    await expect(runGrid()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(localSearchMock).not.toHaveBeenCalled();
  });

  it("rejects an in-flight result when the claimed cell insert loses its lease", async () => {
    const { freshRun } = setupRetryFixture();
    repositoryMocks.getLatestFailedGeoGridRun.mockResolvedValue(null);
    repositoryMocks.getGeoGridRun.mockResolvedValue(freshRun);
    repositoryMocks.insertGeoGridCellClaimed.mockResolvedValue(null);

    await expect(runGrid()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(localSearchMock).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.insertGeoGridCellClaimed).toHaveBeenCalledTimes(1);
  });
});
