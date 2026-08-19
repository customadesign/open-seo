import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  AppDataTable,
  useAppTable,
} from "@/client/components/table/AppDataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { GoogleAnalyticsConnectionCard } from "@/client/features/ga4/GoogleAnalyticsConnectionCard";
import { SearchConsoleConnectionCard } from "@/client/features/gsc/SearchConsoleConnectionCard";
import { buildOpportunityColumns } from "@/client/features/search-performance/SearchOpportunityColumns";
import {
  filterOpportunityRows,
  OPPORTUNITY_MATCH_FILTERS,
  type OpportunityMatchFilter,
  type SearchOpportunityReport,
  type SearchOpportunityResult,
} from "@/client/features/search-performance/searchOpportunityUi";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSearchOpportunities } from "@/serverFunctions/searchOpportunities";
import {
  SEARCH_PERFORMANCE_PAGE_SIZES,
  type SearchPerformanceDateRange,
} from "@/types/schemas/search-performance";

const MATCH_LABELS: Record<OpportunityMatchFilter, string> = {
  all: "All pages",
  matched: "Matched in GA4",
  unmatched: "Not matched in GA4",
};

function isMatchFilter(value: string): value is OpportunityMatchFilter {
  return OPPORTUNITY_MATCH_FILTERS.some((option) => option === value);
}

/** The window the score was computed on, which GA4 clamps to 90 days — it can
 *  be shorter than the range selected for the rest of the page. */
function OpportunityFootnotes({ report }: { report: SearchOpportunityReport }) {
  const { request, coverage, scoring, source, truncated, warnings } = report;
  return (
    <div className="space-y-1 border-t border-base-300 px-4 py-3 text-xs text-base-content/60">
      <p>
        {request.dateRange.startDate} to {request.dateRange.endDate}.{" "}
        {coverage.matchedRows} of {report.totalCandidateRows} candidate pages
        matched a GA4 organic landing page.
      </p>
      <p>
        {source.searchConsoleSiteUrl} joined to{" "}
        {source.googleAnalyticsPropertyDisplayName} (
        {source.googleAnalyticsPropertyId}).
      </p>
      <p>
        Score: {scoring.formula}. Business value uses{" "}
        {scoring.businessValueMetric}
        {scoring.engagementFallback
          ? ", because no key events were recorded in this window"
          : ""}
        . Percentiles are ranked across the matched pages only.
      </p>
      {truncated.candidates ? (
        <p>Showing the highest-scoring pages only; more candidates exist.</p>
      ) : null}
      {truncated.gsc || truncated.ga4 ? (
        <p>Source data hit an API row limit, so some pages are not included.</p>
      ) : null}
      {truncated.queries ? (
        <p>
          The query breakdown hit an API row limit, so a page listed without
          queries may still rank for some.
        </p>
      ) : null}
      {warnings.includes("source_time_zones_differ") ? (
        <p>
          Search Console and Google Analytics report in different time zones, so
          day boundaries differ slightly.
        </p>
      ) : null}
    </div>
  );
}

export function SearchOpportunitiesPanel({
  projectId,
  dateRange,
  canManageConnection,
}: {
  projectId: string;
  dateRange: SearchPerformanceDateRange;
  canManageConnection: boolean;
}) {
  const [match, setMatch] = useState<OpportunityMatchFilter>("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["searchOpportunities", projectId, dateRange],
    queryFn: () => getSearchOpportunities({ data: { projectId, dateRange } }),
    placeholderData: keepPreviousData,
  });
  // Annotated because the type React Query infers for `data` here does not
  // narrow on `status`; without it every branch's fields read as optional.
  const result: SearchOpportunityResult | undefined = query.data;
  const report = result?.status === "ok" ? result : null;

  const rows = useMemo(
    () => filterOpportunityRows(report?.rows ?? [], { match, search }),
    [report?.rows, match, search],
  );
  const columns = useMemo(
    () => buildOpportunityColumns(report?.scoring.businessValueMetric ?? ""),
    [report?.scoring.businessValueMetric],
  );
  const table = useAppTable({
    data: rows,
    columns,
    withSorting: true,
    withPagination: true,
    initialState: {
      sorting: [{ id: "score", desc: true }],
      pagination: { pageIndex: 0, pageSize: 25 },
    },
  });
  const pagination = table.getState().pagination;

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-base-content/60">
        <Loader2 className="size-4 animate-spin" /> Loading opportunities…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="p-4">
        <div className="alert alert-error">
          <span className="text-sm">
            {getStandardErrorMessage(query.error)}
          </span>
        </div>
      </div>
    );
  }
  if (result?.status === "not_connected") {
    const isGa4 = result.missing === "ga4";
    if (!canManageConnection) {
      return (
        <div className="p-4">
          <div className="alert alert-info">
            The opportunity queue joins Search Console with Google Analytics.
            Ask the workspace owner to connect{" "}
            {isGa4 ? "Google Analytics" : "Search Console"} for this project.
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-2xl space-y-3 p-4">
        <p className="text-sm text-base-content/70">
          The opportunity queue scores Search Console pages against their Google
          Analytics organic outcomes. Connect{" "}
          {isGa4 ? "Google Analytics" : "Search Console"} to see it.
        </p>
        {isGa4 ? (
          <GoogleAnalyticsConnectionCard projectId={projectId} />
        ) : (
          <SearchConsoleConnectionCard projectId={projectId} />
        )}
      </div>
    );
  }
  if (result?.status === "error") {
    return (
      <div className="p-4">
        <div className="alert alert-warning">
          <span className="text-sm">{result.error.message}</span>
        </div>
      </div>
    );
  }
  if (!report) return null;

  if (report.rows.length === 0) {
    return (
      <p className="p-6 text-sm text-base-content/60">
        No pages ranked between positions 4 and 20 in this window, so there is
        nothing to prioritize yet. Search Console data trails by a few days.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-base-content/60">
            Pages ranking at positions 4 to 20, scored on search demand, the
            business value of their organic sessions, and how reachable the top
            results are.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {query.isFetching ? (
              <Loader2 className="size-4 animate-spin text-base-content/40" />
            ) : null}
            <input
              type="search"
              className="input input-bordered input-sm w-48"
              placeholder="Filter page or query"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Filter opportunities"
            />
            <select
              className="select select-bordered select-sm w-44"
              value={match}
              onChange={(event) => {
                if (isMatchFilter(event.target.value)) {
                  setMatch(event.target.value);
                }
              }}
              aria-label="Analytics match filter"
            >
              {OPPORTUNITY_MATCH_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {MATCH_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <AppDataTable
          table={table}
          className="table table-zebra table-sm"
          wrapperClassName="overflow-x-auto"
          empty={
            <p className="py-6 text-sm text-base-content/60">
              No opportunities match this filter.
            </p>
          }
        />
      </div>
      {rows.length > 0 ? (
        <TablePagination
          page={pagination.pageIndex + 1}
          pageSize={pagination.pageSize}
          pageSizes={SEARCH_PERFORMANCE_PAGE_SIZES}
          totalCount={rows.length}
          hasNextPage={table.getCanNextPage()}
          isLoading={false}
          onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)}
          onPageSizeChange={(nextSize) => table.setPageSize(nextSize)}
        />
      ) : null}
      <OpportunityFootnotes report={report} />
    </>
  );
}
