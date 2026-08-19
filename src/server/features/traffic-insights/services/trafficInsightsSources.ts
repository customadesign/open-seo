import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";
import { Ga4ReportingService } from "@/server/features/ga4/services/Ga4ReportingService";
import {
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import {
  GscApiError,
  GscNotConnectedError,
  GscTokenError,
} from "@/server/lib/gscErrors";

export const TRAFFIC_INSIGHTS_FETCH_LIMIT = 1_000;

type DateWindow = { projectId: string; startDate: string; endDate: string };

export async function loadGa4Source(input: DateWindow) {
  const connection = await Ga4ConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    return {
      status: "not_connected" as const,
      warnings: [] as string[],
      hasLimitedData: false,
      rows: [] as Array<Record<string, string | number | null>>,
      truncated: false,
    };
  }
  try {
    const report = await Ga4ReportingService.runReport({
      projectId: input.projectId,
      kind: "landing_pages",
      startDate: input.startDate,
      endDate: input.endDate,
      limit: TRAFFIC_INSIGHTS_FETCH_LIMIT,
      offset: 0,
      channel: "organic_search",
    });
    return {
      status: "connected" as const,
      propertyId: report.source.propertyId,
      propertyName: report.source.propertyDisplayName,
      warnings: report.warnings,
      hasLimitedData: report.reportMetadata.hasLimitedData,
      rows: report.rows,
      truncated: report.totalRowCount > report.rows.length,
    };
  } catch (error) {
    if (error instanceof Ga4ReportError) {
      return {
        status: "error" as const,
        code: error.code,
        message: error.message,
        warnings: [] as string[],
        hasLimitedData: false,
        rows: [] as Array<Record<string, string | number | null>>,
        truncated: false,
      };
    }
    throw error;
  }
}

export async function loadGscSource(input: DateWindow) {
  const connection = await GscService.getConnection(input.projectId);
  if (!connection) {
    return {
      status: "not_connected" as const,
      rows: [] as Awaited<ReturnType<typeof GscService.getPerformance>>["rows"],
      queryRows: [] as Awaited<
        ReturnType<typeof GscService.getPerformance>
      >["rows"],
      truncated: false,
      queriesTruncated: false,
    };
  }
  try {
    const [pages, queries] = await Promise.all([
      GscService.getPerformance({
        projectId: input.projectId,
        dimensions: ["page"],
        startDate: input.startDate,
        endDate: input.endDate,
        rowLimit: TRAFFIC_INSIGHTS_FETCH_LIMIT,
        type: "web",
      }),
      GscService.getPerformance({
        projectId: input.projectId,
        dimensions: ["page", "query"],
        startDate: input.startDate,
        endDate: input.endDate,
        rowLimit: TRAFFIC_INSIGHTS_FETCH_LIMIT,
        type: "web",
      }),
    ]);
    return {
      status: "connected" as const,
      siteUrl: pages.siteUrl,
      rows: pages.rows,
      queryRows: queries.rows,
      truncated: pages.rows.length >= TRAFFIC_INSIGHTS_FETCH_LIMIT,
      queriesTruncated: queries.rows.length >= TRAFFIC_INSIGHTS_FETCH_LIMIT,
    };
  } catch (error) {
    if (
      error instanceof GscNotConnectedError ||
      error instanceof GscTokenError ||
      isExpectedGrantFailure(error) ||
      error instanceof GscApiError
    ) {
      const code =
        error instanceof GscNotConnectedError
          ? "gsc_not_connected"
          : error instanceof GscTokenError || isExpectedGrantFailure(error)
            ? "gsc_reconnect_required"
            : "gsc_upstream_unavailable";
      return {
        status: "error" as const,
        code,
        message:
          error instanceof Error
            ? error.message
            : "Search Console reporting is unavailable.",
        rows: [] as Awaited<
          ReturnType<typeof GscService.getPerformance>
        >["rows"],
        queryRows: [] as Awaited<
          ReturnType<typeof GscService.getPerformance>
        >["rows"],
        truncated: false,
        queriesTruncated: false,
      };
    }
    throw error;
  }
}

export async function loadRankTrackingSource(projectId: string) {
  const configs = await RankTrackingRepository.getConfigsForProject(projectId);
  if (configs.length === 0) {
    return {
      status: "not_configured" as const,
      snapshots: [] as Awaited<
        ReturnType<typeof RankTrackingRepository.getLatestSnapshotsForKeywords>
      >,
    };
  }
  const snapshots = (
    await Promise.all(
      configs.map((config) =>
        RankTrackingRepository.getLatestSnapshotsForKeywords(config.id),
      ),
    )
  ).flat();
  return { status: "configured" as const, snapshots };
}
