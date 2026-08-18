/* eslint-disable max-lines -- the report source registry keeps the six source adapters together. */
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { getDatabaseProvider } from "@/db/provider";
import { audits, backlinkSnapshots, projects } from "@/db/schema";
import { getIssueTypePageCountsForAudit } from "@/server/features/audit/repositories/auditSummaryQueries";
import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";
import { Ga4OrganicOverviewService } from "@/server/features/ga4/services/Ga4OrganicOverviewService";
import { Ga4ReportingService } from "@/server/features/ga4/services/Ga4ReportingService";
import { GoogleAdsConnectionRepository } from "@/server/features/google-ads/repositories/GoogleAdsConnectionRepository";
import { GoogleAdsService } from "@/server/features/google-ads/services/GoogleAdsService";
import { GscService } from "@/server/features/gsc/services/GscService";
import type { GscDimension } from "@/server/features/gsc/searchAnalytics";
import {
  buildStrikingDistanceRows,
  sumSearchTotals,
  toDimensionRows,
} from "@/server/features/gsc/searchPerformanceReport";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import {
  distributionFromSnapshotRows,
  RankTrackingReportService,
} from "@/server/features/rank-tracking/services/rankTrackingReports";
import { OrganicTrafficInsightsService } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";
import type { ReportSectionKey, ReportSnapshot } from "@/types/schemas/reports";
import {
  isoEndTimestamp,
  loadAiVisibility,
  loadLocalGeoGrid,
  loadOnPageIdeas,
  type DateRange,
  type SectionLoadResult,
} from "./storedReportSections";

type Section = ReportSnapshot["sections"][number];

function comparison(current: number | null, previous: number | null) {
  const change =
    current != null && previous != null ? current - previous : null;
  return {
    current,
    previous,
    change,
    percentChange:
      change != null && previous != null && previous !== 0
        ? change / previous
        : null,
  };
}

function rankEndTimestamp(date: string) {
  return getDatabaseProvider() === "postgres"
    ? `${date}T23:59:59.999Z`
    : `${date} 23:59:59`;
}

async function loadRankings(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const configs = await RankTrackingRepository.getConfigsForProject(projectId);
  if (configs.length === 0)
    return { status: "omitted", reason: "not_configured" };
  const configReports: Extract<
    Section,
    { key: "rankings" }
  >["data"]["configs"] = [];
  for (const config of configs) {
    const [current, previous] = await Promise.all([
      RankTrackingRepository.getSnapshotsBeforeDate(
        config.id,
        rankEndTimestamp(range.periodEnd),
      ),
      RankTrackingRepository.getSnapshotsBeforeDate(
        config.id,
        rankEndTimestamp(range.compareEnd),
      ),
    ]);
    if (current.length === 0) continue;
    const [baseline, historySources] = await Promise.all([
      RankTrackingRepository.getEarliestSnapshotsForKeywords(config.id, [
        ...new Set(current.map((row) => row.trackingKeywordId)),
      ]),
      RankTrackingRepository.getHistorySourceSummaries(config.id),
    ]);
    const baselineByKey = new Map(
      baseline.map((row) => [`${row.trackingKeywordId}:${row.device}`, row]),
    );
    const legacySources = await Promise.all(
      historySources
        .filter((source) => source.continuity === "legacy")
        .map(async (source) => {
          const movement =
            await RankTrackingRepository.getHistorySourceMovement(
              config.id,
              source.id,
            );
          return {
            sourceId: source.id,
            searchEngine: source.searchEngine,
            locationName: source.sourceLocationName,
            device: source.device,
            firstObservedAt: source.firstObservedAt,
            lastObservedAt: source.lastObservedAt,
            tracked: movement.length,
            improved: movement.filter(
              (row) => row.change != null && row.change > 0,
            ).length,
            declined: movement.filter(
              (row) => row.change != null && row.change < 0,
            ).length,
          };
        }),
    );
    const previousByKey = new Map(
      previous.map((row) => [`${row.trackingKeywordId}:${row.device}`, row]),
    );
    const rows = current.map((row) => {
      const previousRow = previousByKey.get(
        `${row.trackingKeywordId}:${row.device}`,
      );
      const baselineRow = baselineByKey.get(
        `${row.trackingKeywordId}:${row.device}`,
      );
      const change =
        row.position != null && previousRow?.position != null
          ? previousRow.position - row.position
          : null;
      return {
        keyword: row.keyword,
        device: row.device,
        position: row.position,
        previousPosition: previousRow?.position ?? null,
        change,
        rankingUrl: row.url,
        baselinePosition: baselineRow?.position ?? null,
        baselineDate: baselineRow?.checkedAt ?? null,
        lifetimeChange:
          row.position != null && baselineRow?.position != null
            ? baselineRow.position - row.position
            : null,
        baselineSource:
          baselineRow?.sourceProvider === "semrush"
            ? ("semrush" as const)
            : ("openseo" as const),
      };
    });
    const positions = rows.map((row) => row.position);
    const summary = {
      tracked: rows.length,
      top3: positions.filter((position) => position != null && position <= 3)
        .length,
      top10: positions.filter((position) => position != null && position <= 10)
        .length,
      top20: positions.filter((position) => position != null && position <= 20)
        .length,
      improved: rows.filter((row) => row.change != null && row.change > 0)
        .length,
      declined: rows.filter((row) => row.change != null && row.change < 0)
        .length,
      newRankings: rows.filter(
        (row) => row.position != null && row.previousPosition == null,
      ).length,
      lostRankings: rows.filter(
        (row) => row.position == null && row.previousPosition != null,
      ).length,
    };
    const trend = (["desktop", "mobile"] as const).flatMap((device) => {
      const deviceRows = rows.filter((row) => row.device === device);
      if (deviceRows.length === 0) return [];
      return [
        {
          checkedAt:
            current.find((row) => row.device === device)?.checkedAt ??
            range.periodEnd,
          device,
          total: deviceRows.length,
          top3: deviceRows.filter(
            (row) => row.position != null && row.position <= 3,
          ).length,
          top10: deviceRows.filter(
            (row) => row.position != null && row.position <= 10,
          ).length,
          top20: deviceRows.filter(
            (row) => row.position != null && row.position <= 20,
          ).length,
        },
      ];
    });
    const cannibalization = await RankTrackingReportService.getCannibalization(
      config.id,
      projectId,
    );
    configReports.push({
      configId: config.id,
      domain: config.domain,
      locationName: config.locationName,
      devices: config.devices,
      checkedAt: current[0]?.checkedAt ?? null,
      summary,
      rows,
      trend,
      distribution: distributionFromSnapshotRows(current, previous),
      cannibalization: {
        sameSerp: cannibalization.sameSerp.map((finding) => ({
          keyword: finding.keyword,
          device: finding.device,
          currentPosition: finding.currentPosition,
          urls: finding.urls,
        })),
        findings: cannibalization.findings.map((finding) => ({
          keyword: finding.keyword,
          device: finding.device,
          currentPosition: finding.currentPosition,
          currentUrl: finding.currentUrl,
          transitionCount: finding.transitionCount,
          competingUrls: finding.competingUrls,
        })),
        scannedKeywords: cannibalization.scannedKeywords,
        capturedRunCount: cannibalization.capturedRunCount,
      },
      legacySources,
    });
  }
  return configReports.length === 0
    ? { status: "omitted", reason: "no_data" }
    : {
        status: "loaded",
        section: { key: "rankings", data: { configs: configReports } },
      };
}

async function loadGsc(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const connection = await GscService.getConnection(projectId);
  if (!connection) return { status: "omitted", reason: "not_configured" };
  const request = (
    startDate: string,
    endDate: string,
    dimensions: GscDimension[],
    rowLimit: number,
  ) =>
    GscService.getPerformance({
      projectId,
      startDate,
      endDate,
      dimensions,
      rowLimit,
    });
  const [current, previous, queries, pages, opportunities] = await Promise.all([
    request(range.periodStart, range.periodEnd, ["date"], 25_000),
    request(range.compareStart, range.compareEnd, ["date"], 25_000),
    request(range.periodStart, range.periodEnd, ["query"], 25),
    request(range.periodStart, range.periodEnd, ["page"], 25),
    request(range.periodStart, range.periodEnd, ["query", "page"], 1_000),
  ]);
  const currentTotals = sumSearchTotals(current.rows);
  const previousTotals = sumSearchTotals(previous.rows);
  return {
    status: "loaded",
    section: {
      key: "gsc",
      data: {
        siteUrl: current.siteUrl,
        metrics: {
          clicks: comparison(currentTotals.clicks, previousTotals.clicks),
          impressions: comparison(
            currentTotals.impressions,
            previousTotals.impressions,
          ),
          ctr: comparison(currentTotals.ctr, previousTotals.ctr),
          position: comparison(currentTotals.position, previousTotals.position),
        },
        trend: current.rows.map((row) => ({
          date: row.keys?.[0] ?? "",
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        })),
        topQueries: toDimensionRows(queries.rows).map((row) => ({
          ...row,
          query: row.key,
        })),
        topPages: toDimensionRows(pages.rows).map((row) => ({
          ...row,
          page: row.key,
        })),
        opportunities: buildStrikingDistanceRows(opportunities.rows, 25).map(
          (row) => ({
            query: row.query,
            page: row.page,
            impressions: row.impressions,
            position: row.position,
          }),
        ),
      },
    },
  };
}

function normalizedGa4Metrics(
  current: Record<string, string | number | null> | null,
  previous: Record<string, string | number | null> | null,
) {
  const keys = new Set([
    ...Object.keys(current ?? {}),
    ...Object.keys(previous ?? {}),
  ]);
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      comparison(
        typeof current?.[key] === "number" ? current[key] : null,
        typeof previous?.[key] === "number" ? previous[key] : null,
      ),
    ]),
  );
}

async function loadGa4(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const connection = await Ga4ConnectionRepository.getByProjectId(projectId);
  if (!connection) return { status: "omitted", reason: "not_configured" };
  const [current, previous, landingPages, channels, keyEvents] =
    await Promise.all([
      Ga4OrganicOverviewService.getOrganicOverview({
        projectId,
        startDate: range.periodStart,
        endDate: range.periodEnd,
      }),
      Ga4OrganicOverviewService.getOrganicOverview({
        projectId,
        startDate: range.compareStart,
        endDate: range.compareEnd,
      }),
      Ga4ReportingService.runReport({
        projectId,
        kind: "landing_pages",
        startDate: range.periodStart,
        endDate: range.periodEnd,
        limit: 20,
      }),
      Ga4ReportingService.runReport({
        projectId,
        kind: "traffic_acquisition",
        startDate: range.periodStart,
        endDate: range.periodEnd,
        channel: "all",
        limit: 20,
      }),
      Ga4ReportingService.runReport({
        projectId,
        kind: "key_events",
        startDate: range.periodStart,
        endDate: range.periodEnd,
        limit: 20,
      }),
    ]);
  return {
    status: "loaded",
    section: {
      key: "ga4",
      data: {
        propertyId: connection.propertyId,
        propertyName: connection.propertyDisplayName,
        currencyCode: connection.propertyCurrencyCode,
        metrics: normalizedGa4Metrics(current.current, previous.current),
        trend: current.trend,
        topLandingPages: landingPages.rows,
        channels: channels.rows,
        keyEvents: keyEvents.rows,
        warnings: [...new Set([...current.warnings, ...landingPages.warnings])],
      },
    },
  };
}

async function loadGoogleAds(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const connection =
    await GoogleAdsConnectionRepository.getByProjectId(projectId);
  if (!connection) return { status: "omitted", reason: "not_configured" };
  const data = await GoogleAdsService.getPerformanceReport({
    projectId,
    ...range,
  });
  return data
    ? { status: "loaded", section: { key: "google_ads", data } }
    : { status: "omitted", reason: "not_configured" };
}

async function loadAudit(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const rows = await db
    .select()
    .from(audits)
    .where(
      and(
        eq(audits.projectId, projectId),
        eq(audits.status, "completed"),
        lte(audits.completedAt, isoEndTimestamp(range.periodEnd)),
      ),
    )
    .orderBy(desc(audits.completedAt))
    .limit(1);
  const audit = rows[0];
  if (!audit) return { status: "omitted", reason: "no_data" };
  const issues = await getIssueTypePageCountsForAudit(audit.id);
  return {
    status: "loaded",
    section: {
      key: "audit",
      data: {
        auditId: audit.id,
        status: audit.status,
        pagesCrawled: audit.pagesCrawled,
        completedAt: audit.completedAt,
        issues: issues.map((issue) => ({
          issueType: issue.issueType,
          severity: issue.severity,
          affectedPages: issue.pages,
        })),
      },
    },
  };
}

async function loadBacklinks(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const rows = await db
    .select()
    .from(backlinkSnapshots)
    .where(
      and(
        eq(backlinkSnapshots.projectId, projectId),
        lte(backlinkSnapshots.capturedAt, isoEndTimestamp(range.periodEnd)),
      ),
    )
    .orderBy(desc(backlinkSnapshots.capturedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: "omitted", reason: "no_data" };
  return {
    status: "loaded",
    section: {
      key: "backlinks",
      data: {
        domain: row.domain,
        domainRank: row.rank,
        backlinks: row.backlinks,
        referringDomains: row.referringDomains,
        newBacklinks: row.newBacklinks,
        lostBacklinks: row.lostBacklinks,
        capturedAt: row.capturedAt,
      },
    },
  };
}

export async function getReportProject(projectId: string) {
  const rows = await db
    .select({ id: projects.id, name: projects.name, domain: projects.domain })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadTrafficInsights(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const insights = await OrganicTrafficInsightsService.getInsights({
    projectId,
    startDate: range.periodStart,
    endDate: range.periodEnd,
  });
  const nothingConnected =
    insights.sources.ga4.status !== "connected" &&
    insights.sources.gsc.status !== "connected" &&
    insights.sources.rankTracking.status !== "connected";
  if (nothingConnected) return { status: "omitted", reason: "not_configured" };
  if (insights.rows.length === 0)
    return { status: "omitted", reason: "no_data" };

  const sessions = insights.rows.reduce<number | null>((sum, row) => {
    if (row.sessions == null) return sum;
    return (sum ?? 0) + row.sessions;
  }, null);
  const clicks = insights.rows.reduce<number | null>((sum, row) => {
    if (row.clicks == null) return sum;
    return (sum ?? 0) + row.clicks;
  }, null);
  const trackedKeywords = insights.rows.reduce<number | null>((sum, row) => {
    if (row.keywordCount == null) return sum;
    return (sum ?? 0) + row.keywordCount;
  }, null);

  return {
    status: "loaded",
    section: {
      key: "traffic_insights",
      data: {
        range: insights.range,
        sources: {
          ga4:
            insights.sources.ga4.status === "error"
              ? "error"
              : insights.sources.ga4.status === "connected"
                ? "connected"
                : "not_connected",
          gsc:
            insights.sources.gsc.status === "error"
              ? "error"
              : insights.sources.gsc.status === "connected"
                ? "connected"
                : "not_connected",
          rankTracking:
            insights.sources.rankTracking.status === "connected"
              ? "connected"
              : "not_configured",
        },
        summary: {
          pageCount: insights.rows.length,
          sessions,
          clicks,
          trackedKeywords,
        },
        pages: insights.rows.slice(0, 25).map((row) => ({
          url: row.url,
          sessions: row.sessions,
          engagementRate: row.engagementRate,
          keyEvents: row.keyEvents,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          averagePosition: row.averagePosition,
          queries: row.queries.map((query) => query.query).join("; "),
          keywords: row.trackedKeywords
            .map((keyword) => keyword.keyword)
            .join("; "),
          keywordCount: row.keywordCount,
          bestPosition: row.bestPosition,
          coverage: row.coverage.join("+"),
        })),
        warnings: [
          ...insights.sources.ga4.warnings,
          ...(insights.sources.ga4.hasLimitedData ? ["ga4_limited_data"] : []),
        ],
      },
    },
  };
}

export function loadReportSection(
  key: ReportSectionKey,
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  if (key === "rankings") return loadRankings(projectId, range);
  if (key === "gsc") return loadGsc(projectId, range);
  if (key === "ga4") return loadGa4(projectId, range);
  if (key === "google_ads") return loadGoogleAds(projectId, range);
  if (key === "audit") return loadAudit(projectId, range);
  if (key === "backlinks") return loadBacklinks(projectId, range);
  // Stored-only sources: these read rows the project already paid for and
  // never call a provider. See storedReportSections.ts.
  if (key === "ai_visibility") return loadAiVisibility(projectId, range);
  if (key === "local_geo_grid") return loadLocalGeoGrid(projectId, range);
  return loadTrafficInsights(projectId, range);
  return loadOnPageIdeas(projectId, range);
}
