import {
  getCompetitors,
  getTags,
  tagTrackingKeywords,
} from "./rankTrackingTagReports";
import {
  latestTwoRunIds,
  loadReportContext,
  parseSerpFeatures,
  snapshotsForDevice,
  volumeByKeywordId,
  type Device,
  type ReportSnapshotRow,
} from "./rankTrackingReportContext";
import {
  detectCannibalization,
  type CannibalizationFinding,
  type CannibalizationKeyword,
} from "@/shared/rank-tracking-cannibalization";
import {
  countRankBands,
  emptyRankBandCounts,
  groupSnapshotsByPage,
  rankBand,
  rankBandMovement,
  serpFeatureChanges,
  type PageReportRow,
  type RankBandCounts,
  type RankBandMovement,
  type SerpFeatureKeywordRow,
} from "@/shared/rank-tracking-reports";
import {
  estimatedTraffic,
  formatVisibilityContribution,
  visibilityContributions,
  visibilityPercent,
  type VisibilityContribution,
} from "@/shared/rank-tracking-visibility";

export type DistributionReport = {
  trend: Array<{
    runId: string;
    checkedAt: string;
    counts: RankBandCounts;
  }>;
  current: RankBandCounts;
  previous: RankBandCounts | null;
  movement: RankBandMovement;
};

function buildDistribution(
  snapshots: ReportSnapshotRow[],
  runs: Array<{ id: string; startedAt: string }>,
): DistributionReport {
  const { currentRunId, previousRunId } = latestTwoRunIds(runs);
  const countsByRun = new Map<string, RankBandCounts>();
  const keywordPositionByRun = new Map<
    string,
    Array<{ id: string; position: number | null }>
  >();

  for (const snapshot of snapshots) {
    const counts = countsByRun.get(snapshot.runId) ?? emptyRankBandCounts();
    counts[rankBand(snapshot.position)] += 1;
    countsByRun.set(snapshot.runId, counts);

    const rows = keywordPositionByRun.get(snapshot.runId) ?? [];
    rows.push({
      id: snapshot.trackingKeywordId,
      position: snapshot.position,
    });
    keywordPositionByRun.set(snapshot.runId, rows);
  }

  const current = currentRunId
    ? (countsByRun.get(currentRunId) ?? emptyRankBandCounts())
    : emptyRankBandCounts();
  const previous = previousRunId
    ? (countsByRun.get(previousRunId) ?? emptyRankBandCounts())
    : null;
  const movement = rankBandMovement(
    currentRunId ? (keywordPositionByRun.get(currentRunId) ?? []) : [],
    previousRunId ? (keywordPositionByRun.get(previousRunId) ?? []) : [],
  );

  const chronological = runs.toReversed();
  return {
    trend: chronological.map((run) => ({
      runId: run.id,
      checkedAt: run.startedAt,
      counts: countsByRun.get(run.id) ?? emptyRankBandCounts(),
    })),
    current,
    previous,
    movement,
  };
}

async function getDistribution(
  configId: string,
  projectId: string,
  device: Device,
): Promise<DistributionReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  return buildDistribution(snapshotsForDevice(snapshots, device), runs);
}

function groupSnapshotsByKeyword(
  snapshots: ReportSnapshotRow[],
): CannibalizationKeyword[] {
  const grouped = new Map<
    string,
    {
      trackingKeywordId: string;
      keyword: string;
      device: Device;
      snapshots: Array<{
        checkedAt: string;
        url: string | null;
        position: number | null;
      }>;
    }
  >();
  for (const snapshot of snapshots) {
    const key = `${snapshot.trackingKeywordId}:${snapshot.device}`;
    const existing = grouped.get(key);
    const point = {
      checkedAt: snapshot.checkedAt,
      url: snapshot.url,
      position: snapshot.position,
    };
    if (existing) {
      existing.snapshots.push(point);
      continue;
    }
    grouped.set(key, {
      trackingKeywordId: snapshot.trackingKeywordId,
      keyword: snapshot.keyword,
      device: snapshot.device,
      snapshots: [point],
    });
  }
  return [...grouped.values()];
}

export type CannibalizationReport = {
  findings: CannibalizationFinding[];
  scannedKeywords: number;
  runCount: number;
};

async function getCannibalization(
  configId: string,
  projectId: string,
  device?: Device,
): Promise<CannibalizationReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  const scoped = device ? snapshotsForDevice(snapshots, device) : snapshots;
  const keywords = groupSnapshotsByKeyword(scoped);
  return {
    findings: detectCannibalization(keywords),
    scannedKeywords: keywords.length,
    runCount: runs.length,
  };
}

export type PagesReport = {
  pages: PageReportRow[];
};

async function getPages(
  configId: string,
  projectId: string,
  device: Device,
): Promise<PagesReport> {
  const { snapshots, runs, keywords } = await loadReportContext(
    configId,
    projectId,
  );
  const { currentRunId, previousRunId } = latestTwoRunIds(runs);
  const volumes = volumeByKeywordId(keywords);
  const deviceRows = snapshotsForDevice(snapshots, device);
  const toPageRow = (row: ReportSnapshotRow) => ({
    trackingKeywordId: row.trackingKeywordId,
    url: row.url,
    position: row.position,
    searchVolume: volumes.get(row.trackingKeywordId) ?? null,
  });
  return {
    pages: groupSnapshotsByPage(
      deviceRows.filter((row) => row.runId === currentRunId).map(toPageRow),
      deviceRows.filter((row) => row.runId === previousRunId).map(toPageRow),
      estimatedTraffic,
    ),
  };
}

export type SnippetsReport = {
  rows: SerpFeatureKeywordRow[];
  ownedNotStored: true;
};

async function getSnippets(
  configId: string,
  projectId: string,
  device: Device,
): Promise<SnippetsReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  const { currentRunId, previousRunId } = latestTwoRunIds(runs);
  const deviceRows = snapshotsForDevice(snapshots, device);
  const previousById = new Map<string, string[]>();
  for (const row of deviceRows) {
    if (row.runId !== previousRunId) continue;
    previousById.set(
      row.trackingKeywordId,
      parseSerpFeatures(row.serpFeatures),
    );
  }
  return {
    rows: serpFeatureChanges(
      deviceRows
        .filter((row) => row.runId === currentRunId)
        .map((row) => ({
          trackingKeywordId: row.trackingKeywordId,
          keyword: row.keyword,
          position: row.position,
          features: parseSerpFeatures(row.serpFeatures),
        })),
      previousById,
    ),
    ownedNotStored: true,
  };
}

export type VisibilityReport = {
  visibility: number | null;
  previousVisibility: number | null;
  delta: number | null;
  contributions: VisibilityContribution[];
  summary: string[];
};

async function getVisibilityAttribution(
  configId: string,
  projectId: string,
  device: Device,
): Promise<VisibilityReport> {
  const { snapshots, runs, keywords } = await loadReportContext(
    configId,
    projectId,
  );
  const { currentRunId, previousRunId } = latestTwoRunIds(runs);
  const volumes = volumeByKeywordId(keywords);
  const deviceRows = snapshotsForDevice(snapshots, device);
  const previousById = new Map<string, number | null>();
  for (const row of deviceRows) {
    if (row.runId !== previousRunId) continue;
    previousById.set(row.trackingKeywordId, row.position);
  }

  const rows = deviceRows
    .filter((row) => row.runId === currentRunId)
    .map((row) => ({
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      searchVolume: volumes.get(row.trackingKeywordId) ?? null,
      position: row.position,
      previousPosition: previousById.get(row.trackingKeywordId) ?? null,
    }));

  const visibility = visibilityPercent(rows);
  const previousVisibility = visibilityPercent(
    rows.map((row) => ({
      searchVolume: row.searchVolume,
      position: row.previousPosition,
    })),
  );
  const contributions = visibilityContributions(rows);
  return {
    visibility,
    previousVisibility,
    delta:
      visibility != null && previousVisibility != null
        ? visibility - previousVisibility
        : null,
    contributions,
    summary: contributions
      .filter((row) => Math.abs(row.contribution) >= 0.01)
      .slice(0, 8)
      .map((row) =>
        formatVisibilityContribution(row.keyword, row.contribution),
      ),
  };
}

export function distributionFromSnapshotRows(
  current: Array<{ trackingKeywordId: string; position: number | null }>,
  previous: Array<{ trackingKeywordId: string; position: number | null }>,
) {
  return {
    current: countRankBands(current.map((row) => row.position)),
    previous: countRankBands(previous.map((row) => row.position)),
    movement: rankBandMovement(
      current.map((row) => ({
        id: row.trackingKeywordId,
        position: row.position,
      })),
      previous.map((row) => ({
        id: row.trackingKeywordId,
        position: row.position,
      })),
    ),
  };
}

export const RankTrackingReportService = {
  getDistribution,
  getCannibalization,
  getPages,
  getSnippets,
  getVisibilityAttribution,
  getTags,
  getCompetitors,
  tagTrackingKeywords,
};
