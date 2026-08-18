import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { getIssueTypePageCountsForAudit } from "@/server/features/audit/repositories/auditSummaryQueries";
import { BacklinkSnapshotRepository } from "@/server/features/dashboard/repositories/BacklinkSnapshotRepository";
import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";
import { Ga4OrganicOverviewService } from "@/server/features/ga4/services/Ga4OrganicOverviewService";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { getLatestResults } from "@/server/features/rank-tracking/services/rankTrackingResults";
import { ReportSourceRepository } from "./repositories/ReportSourceRepository";
import { ChangesReportSectionService } from "./services/ChangesReportSectionService";
import type {
  ReportSectionDataSource,
  ReportSectionLoadResult,
} from "./ReportSnapshotAssembler";

async function loadRank(projectId: string): Promise<ReportSectionLoadResult> {
  const configs = await RankTrackingRepository.getConfigsForProject(projectId);
  if (configs.length === 0) return { status: "no_data" };
  const results = await Promise.all(
    configs.map(async (config) => ({
      config,
      result: await getLatestResults(config.id, projectId, "30d"),
    })),
  );
  return {
    status: "available",
    data: results
      .map(({ config, result }) => {
        const positions = result.rows.flatMap((row) => [
          row.desktop.position,
          row.mobile.position,
        ]);
        const ranked = positions.filter(
          (value): value is number => value !== null,
        );
        let improved = 0;
        let declined = 0;
        for (const row of result.rows) {
          for (const device of [row.desktop, row.mobile]) {
            if (device.position === null || device.previousPosition === null)
              continue;
            if (device.position < device.previousPosition) improved += 1;
            if (device.position > device.previousPosition) declined += 1;
          }
        }
        return {
          configId: config.id,
          domain: config.domain,
          locationName: config.locationName,
          keywordCount: result.rows.length,
          averagePosition:
            ranked.length === 0
              ? null
              : ranked.reduce((total, value) => total + value, 0) /
                ranked.length,
          topThree: ranked.filter((position) => position <= 3).length,
          topTen: ranked.filter((position) => position <= 10).length,
          improved,
          declined,
          lastCheckedAt: result.run?.lastCheckedAt ?? null,
        };
      })
      .toSorted((a, b) => a.configId.localeCompare(b.configId)),
  };
}

async function loadAudit(projectId: string): Promise<ReportSectionLoadResult> {
  const audit = await AuditRepository.getLatestAuditForProject(projectId);
  if (!audit) return { status: "no_data" };
  const issues = await getIssueTypePageCountsForAudit(audit.id);
  return {
    status: "available",
    data: {
      auditId: audit.id,
      status: audit.status,
      pagesCrawled: audit.pagesCrawled,
      pagesTotal: audit.pagesTotal,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      issues: issues
        .map((issue) => ({
          issueType: issue.issueType,
          severity: issue.severity,
          affectedPages: issue.pages,
        }))
        .toSorted(
          (a, b) =>
            a.severity.localeCompare(b.severity) ||
            b.affectedPages - a.affectedPages ||
            a.issueType.localeCompare(b.issueType),
        ),
    },
  };
}

async function loadBacklinks(
  projectId: string,
): Promise<ReportSectionLoadResult> {
  const snapshot =
    await BacklinkSnapshotRepository.getLatestForProject(projectId);
  if (!snapshot) return { status: "no_data" };
  return {
    status: "available",
    data: {
      domain: snapshot.domain,
      domainRank: snapshot.rank,
      backlinks: snapshot.backlinks,
      referringDomains: snapshot.referringDomains,
      newBacklinks: snapshot.newBacklinks,
      lostBacklinks: snapshot.lostBacklinks,
      newReferringDomains: snapshot.newReferringDomains,
      lostReferringDomains: snapshot.lostReferringDomains,
      capturedAt: snapshot.capturedAt,
    },
  };
}

async function loadLocal(projectId: string): Promise<ReportSectionLoadResult> {
  const data = await ReportSourceRepository.getLocalSummary(projectId);
  return data.gridRuns.length === 0 && data.citationAudit === null
    ? { status: "no_data" }
    : { status: "available", data };
}

async function loadGsc(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<ReportSectionLoadResult> {
  const connection = await GscConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) return { status: "not_configured" };
  const report = await GscService.getPerformance({
    projectId: input.projectId,
    startDate: input.periodStart.slice(0, 10),
    endDate: input.periodEnd.slice(0, 10),
    dimensions: ["date"],
    rowLimit: 1_000,
    dataState: "final",
  });
  const clicks = report.rows.reduce((total, row) => total + row.clicks, 0);
  const impressions = report.rows.reduce(
    (total, row) => total + row.impressions,
    0,
  );
  const weightedPosition = report.rows.reduce(
    (total, row) => total + row.position * row.impressions,
    0,
  );
  return {
    status: "available",
    data: {
      siteUrl: report.siteUrl,
      clicks,
      impressions,
      ctr: impressions === 0 ? 0 : clicks / impressions,
      position: impressions === 0 ? 0 : weightedPosition / impressions,
      trend: report.rows
        .map((row) => ({
          date: row.keys?.[0] ?? "",
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        }))
        .toSorted((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

async function loadGa4(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
}): Promise<ReportSectionLoadResult> {
  const connection = await Ga4ConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) return { status: "not_configured" };
  const report = await Ga4OrganicOverviewService.getOrganicOverview(
    {
      projectId: input.projectId,
      startDate: input.periodStart.slice(0, 10),
      endDate: input.periodEnd.slice(0, 10),
      trend: "daily",
    },
    { now: new Date(input.generatedAt) },
  );
  return {
    status: "available",
    data: {
      source: report.source,
      request: report.request,
      current: report.current,
      previous: report.previous,
      comparison: report.comparison,
      trend: report.trend,
      diagnostics: report.diagnostics,
      warnings: report.warnings,
    },
  };
}

export const defaultReportSectionDataSource: ReportSectionDataSource = {
  load(key, input) {
    switch (key) {
      case "rank":
        return loadRank(input.projectId);
      case "audit":
        return loadAudit(input.projectId);
      case "backlinks":
        return loadBacklinks(input.projectId);
      case "local":
        return loadLocal(input.projectId);
      case "gsc":
        return loadGsc(input);
      case "ga4":
        return loadGa4(input);
      case "changes":
        return ChangesReportSectionService.load(input);
    }
  },
};
