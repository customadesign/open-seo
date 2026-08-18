import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import {
  getPageSeverityCountsForAudit,
  getRecentCompletedAudits,
} from "@/server/features/audit/repositories/auditSummaryQueries";
import { BacklinkSnapshotRepository } from "@/server/features/dashboard/repositories/BacklinkSnapshotRepository";
import { DomainOverviewSnapshotRepository } from "@/server/features/dashboard/repositories/DomainOverviewSnapshotRepository";
import type {
  DashboardBacklinkMetricSource,
  DashboardDomainOverviewSource,
  DashboardMetricSources,
  DashboardSiteHealthSource,
  DashboardVisibilitySource,
} from "@/server/features/dashboard/services/dashboardMetricTypes";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { getLatestResults } from "@/server/features/rank-tracking/services/rankTrackingResults";
import {
  computeVisibility,
  type VisibilityEntry,
} from "@/shared/rank-visibility";
import { computeSiteHealthScore } from "@/shared/site-health";

// Reads the persisted data behind the seven dashboard metrics. Snapshot tables
// and audit rows only — no provider calls, so opening the dashboard never spends
// credits.

/** Bounds the per-config result reads; projects rarely have more than a couple. */
const MAX_CONFIGS_FOR_OVERVIEW = 5;

/** Latest plus one for the delta. */
const SNAPSHOT_HISTORY_DEPTH = 2;

export async function getDashboardMetricSources(input: {
  projectId: string;
  domain: string | null;
}): Promise<DashboardMetricSources> {
  const [aiVisibility, siteHealth, visibility, domainOverview, backlinks] =
    await Promise.all([
      AiVisibilityService.getState(input.projectId),
      getSiteHealthSource(input.projectId),
      getVisibilitySource(input.projectId),
      getDomainOverviewSource(input.projectId, input.domain),
      getBacklinkMetricSource(input.projectId, input.domain),
    ]);

  return {
    hasDomain: input.domain !== null,
    aiVisibility,
    siteHealth,
    visibility,
    domainOverview,
    backlinks,
  };
}

async function getSiteHealthSource(
  projectId: string,
): Promise<DashboardSiteHealthSource | null> {
  const audits = await getRecentCompletedAudits(
    projectId,
    SNAPSHOT_HISTORY_DEPTH,
  );
  const [latest, previous] = audits;
  if (!latest) return null;

  const [latestCounts, previousCounts] = await Promise.all([
    getPageSeverityCountsForAudit(latest.id),
    previous ? getPageSeverityCountsForAudit(previous.id) : Promise.resolve([]),
  ]);

  return {
    score: computeSiteHealthScore({
      pagesCrawled: latest.pagesCrawled,
      pageSeverityCounts: latestCounts,
    }),
    previousScore: previous
      ? computeSiteHealthScore({
          pagesCrawled: previous.pagesCrawled,
          pageSeverityCounts: previousCounts,
        })
      : null,
    pagesCrawled: latest.pagesCrawled,
    capturedAt: latest.completedAt ?? latest.startedAt,
  };
}

async function getVisibilitySource(
  projectId: string,
): Promise<DashboardVisibilitySource | null> {
  const configs = await RankTrackingRepository.getConfigsForProject(projectId);
  if (configs.length === 0) return null;

  const scoped = configs.slice(0, MAX_CONFIGS_FOR_OVERVIEW);
  const results = await Promise.all(
    scoped.map((config) => getLatestResults(config.id, projectId, "7d")),
  );

  const entries: VisibilityEntry[] = [];
  let trackedKeywords = 0;
  let capturedAt: string | null = null;

  for (const [index, result] of results.entries()) {
    // Only devices the config actually tracks: an untracked device has null
    // positions for every keyword, which would halve the score.
    const devices = scoped[index].devices;
    const tracked =
      devices === "both"
        ? (["desktop", "mobile"] as const)
        : ([devices] as const);

    trackedKeywords += result.rows.length;
    if (
      result.run?.lastCheckedAt &&
      (!capturedAt || result.run.lastCheckedAt > capturedAt)
    ) {
      capturedAt = result.run.lastCheckedAt;
    }
    for (const row of result.rows) {
      for (const device of tracked) {
        entries.push({
          searchVolume: row.searchVolume,
          position: row[device].position,
          previousPosition: row[device].previousPosition,
        });
      }
    }
  }

  const score = computeVisibility(entries);
  return {
    current: score.current,
    previous: score.previous,
    trackedKeywords,
    capturedAt,
  };
}

async function getDomainOverviewSource(
  projectId: string,
  domain: string | null,
): Promise<DashboardDomainOverviewSource | null> {
  if (!domain) return null;
  const snapshots = await DomainOverviewSnapshotRepository.getRecentForProject(
    projectId,
    SNAPSHOT_HISTORY_DEPTH,
  );
  const [latest, previous] = snapshots;
  // A snapshot for a previous domain describes a different site, so it is not
  // this project's number — report "collecting", not stale data.
  if (!latest || latest.domain !== domain) return null;
  const comparable = previous?.domain === domain ? previous : null;

  return {
    organicTraffic: latest.organicTraffic,
    organicKeywords: latest.organicKeywords,
    previousOrganicTraffic: comparable?.organicTraffic ?? null,
    previousOrganicKeywords: comparable?.organicKeywords ?? null,
    capturedAt: latest.capturedAt,
  };
}

async function getBacklinkMetricSource(
  projectId: string,
  domain: string | null,
): Promise<DashboardBacklinkMetricSource | null> {
  if (!domain) return null;
  const snapshots = await BacklinkSnapshotRepository.getRecentForProject(
    projectId,
    SNAPSHOT_HISTORY_DEPTH,
  );
  const [latest, previous] = snapshots;
  if (!latest || latest.domain !== domain) return null;
  const comparable = previous?.domain === domain ? previous : null;

  return {
    backlinks: latest.backlinks,
    previousBacklinks: comparable?.backlinks ?? null,
    capturedAt: latest.capturedAt,
  };
}
