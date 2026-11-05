import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestResults } from "./rankTrackingResults";

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getKeywordsForConfig: vi.fn(),
  getLatestSnapshotsForKeywords: vi.fn(),
  getSnapshotsBeforeDate: vi.fn(),
  getLatestRunForConfig: vi.fn(),
  getEarliestSnapshotsForKeywords: vi.fn(),
  getBestPositionsForConfig: vi.fn(),
}));

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);

describe("getLatestResults", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({ id: "config_1" });
    mocks.getKeywordsForConfig.mockResolvedValue([]);
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.getSnapshotsBeforeDate.mockResolvedValue([]);
    mocks.getEarliestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.getBestPositionsForConfig.mockResolvedValue([]);
  });

  it("keeps snapshot freshness when a newer run fails before writing snapshots", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue([
      {
        id: "kw_1",
        keyword: "open seo",
        searchVolume: 100,
        keywordDifficulty: 10,
        cpc: 1,
      },
    ]);
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([
      {
        trackingKeywordId: "kw_1",
        device: "desktop",
        runId: "run_1",
        checkedAt: "2026-08-01 10:00:00",
        position: 3,
        url: "https://example.com/",
        serpFeatures: null,
      },
    ]);
    mocks.getLatestRunForConfig.mockResolvedValue({
      id: "run_2",
      status: "failed",
      errorMessage: "Provider request timed out",
    });

    await expect(
      getLatestResults("config_1", "project_1"),
    ).resolves.toMatchObject({
      run: {
        id: "run_2",
        lastCheckedAt: "2026-08-01 10:00:00",
        status: "failed",
        errorMessage: "Provider request timed out",
      },
    });
  });

  it("surfaces the latest failed run and its error message", async () => {
    mocks.getLatestRunForConfig.mockResolvedValue({
      id: "run_1",
      status: "failed",
      errorMessage: "Provider request timed out",
    });

    await expect(
      getLatestResults("config_1", "project_1"),
    ).resolves.toMatchObject({
      run: {
        id: "run_1",
        lastCheckedAt: null,
        status: "failed",
        errorMessage: "Provider request timed out",
      },
    });
  });

  // A keyword the newest check skipped keeps an older snapshot; it must not
  // read as a fresh "not found", or it lands in the removal list.
  it("flags keywords whose latest snapshot predates the newest check", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue(
      ["kw_fresh", "kw_skipped"].map((id) => ({ id, keyword: id })),
    );
    const snapshot = {
      device: "desktop",
      position: null,
      url: null,
      serpFeatures: null,
    };
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([
      {
        ...snapshot,
        trackingKeywordId: "kw_fresh",
        runId: "run_2",
        checkedAt: "2026-09-28 09:00:00",
      },
      {
        ...snapshot,
        trackingKeywordId: "kw_skipped",
        runId: "run_1",
        checkedAt: "2026-08-17 11:00:00",
      },
    ]);
    mocks.getBestPositionsForConfig.mockResolvedValue([
      { trackingKeywordId: "kw_fresh", device: "desktop", bestPosition: 11 },
    ]);
    mocks.getLatestRunForConfig.mockResolvedValue(null);

    const { rows } = await getLatestResults("config_1", "project_1");

    expect(
      rows.map((row) => [
        row.keyword,
        row.desktop.checkedInLatestCheck,
        row.desktop.bestPosition,
      ]),
    ).toEqual([
      ["kw_fresh", true, 11],
      ["kw_skipped", false, null],
    ]);
  });
});
