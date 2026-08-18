import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import {
  detectCannibalization,
  detectSameSerpFindings,
  type CannibalizationFinding,
  type CannibalizationKeyword,
  type SameSerpFinding,
  type SameSerpKeyword,
} from "@/shared/rank-tracking-cannibalization";
import {
  discoverCompetitors,
  type CompetitorDiscoveryRow,
} from "@/shared/rank-tracking-competitors";
import {
  detectSnippetOwnership,
  type SnippetOwnershipRow,
} from "@/shared/rank-tracking-snippets";
import {
  serpDetailStatus,
  type SerpDetailStatus,
} from "@/shared/rank-serp-retention";
import {
  capturedRunsForDevice,
  loadReportContext,
  retainedSerpRuns,
  snapshotsForDevice,
  type Device,
  type ReportSnapshotRow,
} from "./rankTrackingReportContext";

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

function sameSerpKeywordsFromEntries(
  entries: Awaited<
    ReturnType<typeof RankTrackingRepository.getSerpEntriesForRuns>
  >,
  snapshots: ReportSnapshotRow[],
): SameSerpKeyword[] {
  const keywordById = new Map(
    snapshots.map((row) => [row.trackingKeywordId, row.keyword]),
  );
  const grouped = new Map<
    string,
    {
      trackingKeywordId: string;
      keyword: string;
      device: Device;
      urls: Array<{ url: string; position: number }>;
    }
  >();
  for (const entry of entries) {
    if (entry.url == null || entry.position == null) continue;
    const key = `${entry.trackingKeywordId}:${entry.device}`;
    const existing = grouped.get(key);
    const url = { url: entry.url, position: entry.position };
    if (existing) {
      existing.urls.push(url);
      continue;
    }
    grouped.set(key, {
      trackingKeywordId: entry.trackingKeywordId,
      keyword: keywordById.get(entry.trackingKeywordId) ?? "",
      device: entry.device,
      urls: [url],
    });
  }
  return [...grouped.values()];
}

export type CannibalizationReport = {
  sameSerp: SameSerpFinding[];
  urlFlips: CannibalizationFinding[];
  findings: CannibalizationFinding[];
  scannedKeywords: number;
  runCount: number;
  capturedRunCount: number;
  retainedRunCount: number;
  capturedSince: string | null;
  serpDetail: SerpDetailStatus;
};

export async function getCannibalization(
  configId: string,
  projectId: string,
  device?: Device,
): Promise<CannibalizationReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  const scoped = device ? snapshotsForDevice(snapshots, device) : snapshots;
  const keywords = groupSnapshotsByKeyword(scoped);
  const capturedRuns = device
    ? capturedRunsForDevice(snapshots, runs, device)
    : runs.filter((run) =>
        snapshots.some((row) => row.runId === run.id && row.serpCaptured),
      );
  const retainedRuns = retainedSerpRuns(snapshots, runs, device);
  const latestRetainedId = retainedRuns[0]?.id;
  const ownedEntries = latestRetainedId
    ? await RankTrackingRepository.getSerpEntriesForRuns([latestRetainedId], {
        rowKind: "owned",
        device,
      })
    : [];
  const urlFlips = detectCannibalization(keywords);
  return {
    sameSerp: detectSameSerpFindings(
      sameSerpKeywordsFromEntries(ownedEntries, scoped),
    ),
    urlFlips,
    findings: urlFlips,
    scannedKeywords: keywords.length,
    runCount: runs.length,
    capturedRunCount: capturedRuns.length,
    retainedRunCount: retainedRuns.length,
    capturedSince: retainedRuns.at(-1)?.startedAt ?? null,
    serpDetail: serpDetailStatus({
      capturedRunCount: capturedRuns.length,
      retainedRunCount: retainedRuns.length,
    }),
  };
}

export type SnippetsReport = {
  ownershipAvailable: boolean;
  capturedRunCount: number;
  retainedRunCount: number;
  capturedSince: string | null;
  serpDetail: SerpDetailStatus;
  rows: SnippetOwnershipRow[];
};

export async function getSnippets(
  configId: string,
  projectId: string,
  device: Device,
): Promise<SnippetsReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  const capturedRuns = capturedRunsForDevice(snapshots, runs, device);
  const retainedRuns = retainedSerpRuns(snapshots, runs, device);
  const currentRunId = retainedRuns[0]?.id ?? null;
  const previousRunId = retainedRuns[1]?.id ?? null;
  const deviceRows = snapshotsForDevice(snapshots, device);
  const positionByRunKeyword = new Map(
    deviceRows.map((row) => [
      `${row.runId}:${row.trackingKeywordId}`,
      row.position,
    ]),
  );
  const keywordById = new Map(
    deviceRows.map((row) => [row.trackingKeywordId, row.keyword]),
  );
  const runIds = [currentRunId, previousRunId].filter(
    (id): id is string => id != null,
  );
  const featureEntries =
    runIds.length > 0
      ? await RankTrackingRepository.getSerpEntriesForRuns(runIds, {
          rowKind: "feature",
          device,
        })
      : [];

  const toOwnership = (runId: string | null) =>
    featureEntries
      .filter((entry) => entry.runId === runId && entry.featureOwned != null)
      .map((entry) => ({
        trackingKeywordId: entry.trackingKeywordId,
        keyword: keywordById.get(entry.trackingKeywordId) ?? "",
        position:
          positionByRunKeyword.get(`${runId}:${entry.trackingKeywordId}`) ??
          null,
        feature: entry.identity,
        owned: entry.featureOwned === true,
      }));

  return {
    ownershipAvailable: currentRunId != null,
    capturedRunCount: capturedRuns.length,
    retainedRunCount: retainedRuns.length,
    capturedSince: retainedRuns.at(-1)?.startedAt ?? null,
    serpDetail: serpDetailStatus({
      capturedRunCount: capturedRuns.length,
      retainedRunCount: retainedRuns.length,
    }),
    rows: detectSnippetOwnership(
      toOwnership(currentRunId),
      toOwnership(previousRunId),
    ),
  };
}

export type CompetitorsReport = {
  available: boolean;
  reason: "serp_not_captured" | "serp_pruned" | "no_checks" | null;
  capturedRunCount: number;
  retainedRunCount: number;
  capturedSince: string | null;
  serpDetail: SerpDetailStatus;
  competitors: CompetitorDiscoveryRow[];
};

export async function getCompetitors(
  configId: string,
  projectId: string,
  device: Device,
): Promise<CompetitorsReport> {
  const { snapshots, runs } = await loadReportContext(configId, projectId);
  if (runs.length === 0) {
    return {
      available: false,
      reason: "no_checks",
      capturedRunCount: 0,
      retainedRunCount: 0,
      capturedSince: null,
      serpDetail: "none",
      competitors: [],
    };
  }
  const capturedRuns = capturedRunsForDevice(snapshots, runs, device);
  const retainedRuns = retainedSerpRuns(snapshots, runs, device);
  const detail = serpDetailStatus({
    capturedRunCount: capturedRuns.length,
    retainedRunCount: retainedRuns.length,
  });
  if (retainedRuns.length === 0) {
    return {
      available: false,
      reason: detail === "pruned" ? "serp_pruned" : "serp_not_captured",
      capturedRunCount: capturedRuns.length,
      retainedRunCount: 0,
      capturedSince: null,
      serpDetail: detail,
      competitors: [],
    };
  }
  const entries = await RankTrackingRepository.getSerpEntriesForRuns(
    retainedRuns.map((run) => run.id),
    { rowKind: "competitor", device },
  );
  return {
    available: true,
    reason: null,
    capturedRunCount: capturedRuns.length,
    retainedRunCount: retainedRuns.length,
    capturedSince: retainedRuns.at(-1)?.startedAt ?? null,
    serpDetail: detail,
    competitors: discoverCompetitors(
      entries.map((entry) => ({
        trackingKeywordId: entry.trackingKeywordId,
        domain: entry.domain ?? entry.identity,
        position: entry.position,
        runId: entry.runId,
      })),
    ),
  };
}
