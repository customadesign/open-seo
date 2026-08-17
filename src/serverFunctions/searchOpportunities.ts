import { createServerFn } from "@tanstack/react-start";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import {
  groupTopQueriesByPage,
  type PageRankingQuery,
} from "@/server/features/gsc/searchPerformanceReport";
import { SearchOpportunityService } from "@/server/features/ga4/services/SearchOpportunityService";
import {
  Ga4ReportError,
  toSafeGa4ReportErrorDetail,
} from "@/server/lib/ga4Errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { searchOpportunitiesInputSchema } from "@/types/schemas/search-performance";

// The service caps `limit` at 100. Ask for the full cap once and paginate the
// queue client-side; a second call would re-run the whole GSC + GA4 join.
const OPPORTUNITY_LIMIT = 100;
// page x query fan-out, so the per-page top queries survive a wide site.
const TOP_QUERY_FETCH_LIMIT = 1000;
const TOP_QUERIES_PER_PAGE = 3;

/** Which side of the join is missing, so the tab can render the right connect
 *  card instead of a generic error. */
function connectionGap(error: unknown): "gsc" | "ga4" | null {
  if (error instanceof GscNotConnectedError || isExpectedGrantFailure(error)) {
    return "gsc";
  }
  if (
    error instanceof Ga4ReportError &&
    (error.code === "ga4_not_connected" ||
      error.code === "ga4_reconnect_required")
  ) {
    return "ga4";
  }
  return null;
}

/**
 * The queries each opportunity page already ranks for, over the window the
 * score was computed on. Both calls read the same verified property, so the
 * `page` key is byte-identical on either side and needs no normalization.
 */
async function topQueriesByPage(
  projectId: string,
  range: { startDate: string; endDate: string },
): Promise<{ byPage: Map<string, PageRankingQuery[]>; truncated: boolean }> {
  const result = await GscService.getPerformance({
    projectId,
    dimensions: ["page", "query"],
    startDate: range.startDate,
    endDate: range.endDate,
    rowLimit: TOP_QUERY_FETCH_LIMIT,
    startRow: 0,
    type: "web",
    dataState: "final",
  });
  return {
    byPage: groupTopQueriesByPage(result.rows, TOP_QUERIES_PER_PAGE),
    // At the cap, a page can be missing its queries entirely, so the view must
    // not present an empty query list as "this page ranks for nothing".
    truncated: result.rows.length >= TOP_QUERY_FETCH_LIMIT,
  };
}

/**
 * The project's search opportunity queue: the existing GSC-plus-GA4 join and
 * score, plus the queries each page ranks for. Scoring stays in
 * SearchOpportunityService so this view and the MCP tool cannot disagree.
 * All first-party Google data — no OpenSEO credits are spent.
 */
export const getSearchOpportunities = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(searchOpportunitiesInputSchema)
  .handler(async ({ data, context }) => {
    const { startDate, endDate } = resolveDateRange({
      dateRange: data.dateRange,
    });

    try {
      const result = await SearchOpportunityService.getOpportunities({
        projectId: context.projectId,
        startDate,
        endDate,
        limit: OPPORTUNITY_LIMIT,
      });
      // GA4 clamps the window to its 90-day floor, so enrich against the range
      // the score was actually computed on rather than the requested one.
      const queriesByPage = await topQueriesByPage(
        context.projectId,
        result.request.dateRange,
      );

      return {
        status: "ok" as const,
        source: result.source,
        request: result.request,
        scoring: result.scoring,
        coverage: result.coverage,
        truncated: { ...result.truncated, queries: queriesByPage.truncated },
        warnings: result.warnings,
        totalCandidateRows: result.totalCandidateRows,
        rows: result.rows.map((row) => ({
          ...row,
          topQueries: queriesByPage.byPage.get(row.page) ?? [],
        })),
      };
    } catch (error) {
      const gap = connectionGap(error);
      if (gap) return { status: "not_connected" as const, missing: gap };
      if (error instanceof Ga4ReportError) {
        return {
          status: "error" as const,
          error: toSafeGa4ReportErrorDetail(error),
        };
      }
      throw error;
    }
  });
