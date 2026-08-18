import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TableExportMenu } from "@/client/components/table/TableBulkActionBar";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { GoogleAnalyticsConnectionCard } from "@/client/features/ga4/GoogleAnalyticsConnectionCard";
import { SearchConsoleConnectionCard } from "@/client/features/gsc/SearchConsoleConnectionCard";
import { TrafficInsightsLoadingState } from "@/client/features/traffic-insights/TrafficInsightsLoadingState";
import { TrafficInsightsTable } from "@/client/features/traffic-insights/TrafficInsightsTable";
import { exportTrafficInsightsCsv } from "@/client/features/traffic-insights/trafficInsightsExport";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getOrganicTrafficInsights } from "@/serverFunctions/trafficInsights";
import type { TrafficInsightsResult } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";
import {
  SEARCH_PERFORMANCE_RANGES,
  type SearchPerformanceDateRange,
} from "@/types/schemas/search-performance";

const RANGE_LABELS: Record<SearchPerformanceDateRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_3_months: "Last 3 months",
};

function isDateRange(value: string): value is SearchPerformanceDateRange {
  return SEARCH_PERFORMANCE_RANGES.some((option) => option === value);
}

function sourceLabel(
  status: TrafficInsightsResult["sources"]["ga4"]["status"],
) {
  if (status === "connected") return "Connected";
  if (status === "not_connected") return "Not connected";
  if (status === "not_configured") return "Not configured";
  return "Unavailable";
}

export function TrafficInsightsPage({ projectId }: { projectId: string }) {
  const accessQuery = useWorkspaceAccess();
  const canManageConnection = accessQuery.data?.canManageWorkspace === true;
  const [range, setRange] =
    useState<SearchPerformanceDateRange>("last_28_days");
  const query = useQuery({
    queryKey: ["trafficInsights", projectId, range],
    queryFn: () =>
      getOrganicTrafficInsights({ data: { projectId, dateRange: range } }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  const handleExport = () => {
    if (!data) return;
    try {
      exportTrafficInsightsCsv(data);
    } catch (error) {
      toast.error(getStandardErrorMessage(error, "Export failed"));
    }
  };

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Organic Traffic Insights</h1>
            <p className="text-sm text-base-content/70">
              Join Analytics landing pages, Search Console queries, and tracked
              rankings so you can see which keywords actually brought sessions
              to each URL.
            </p>
          </div>
          {data ? (
            <select
              className="select select-bordered select-sm w-36 self-start"
              value={range}
              onChange={(event) => {
                if (isDateRange(event.target.value))
                  setRange(event.target.value);
              }}
              aria-label="Date range"
            >
              {SEARCH_PERFORMANCE_RANGES.map((value) => (
                <option key={value} value={value}>
                  {RANGE_LABELS[value]}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {query.isPending ? (
          <TrafficInsightsLoadingState />
        ) : query.isError ? (
          <div className="alert alert-error">
            <span className="text-sm">
              {getStandardErrorMessage(query.error)}
            </span>
          </div>
        ) : data ? (
          <>
            <SourceStatusCards
              projectId={projectId}
              data={data}
              canManageConnection={canManageConnection}
            />
            <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
              <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                <p className="text-sm text-base-content/60">
                  {data.rows.length} landing page
                  {data.rows.length === 1 ? "" : "s"}
                  {data.truncated.ga4 || data.truncated.gsc
                    ? " · results capped at 1,000 rows per source"
                    : ""}
                </p>
                <div className="flex items-center gap-2">
                  {query.isFetching && !query.isPending ? (
                    <Loader2 className="size-4 animate-spin text-base-content/40" />
                  ) : null}
                  <TableExportMenu
                    buttonClassName="btn btn-ghost btn-sm gap-1"
                    actions={[
                      {
                        label: "Download CSV",
                        icon: <Download className="size-4" />,
                        onClick: handleExport,
                      },
                    ]}
                  />
                </div>
              </div>
              <TrafficInsightsTable rows={data.rows} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SourceStatusCards({
  projectId,
  data,
  canManageConnection,
}: {
  projectId: string;
  data: TrafficInsightsResult;
  canManageConnection: boolean;
}) {
  const { ga4, gsc, rankTracking } = data.sources;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard
          label="Google Analytics"
          status={sourceLabel(ga4.status)}
          detail={
            ga4.propertyName ?? ("message" in ga4 ? ga4.message : undefined)
          }
        />
        <StatusCard
          label="Search Console"
          status={sourceLabel(gsc.status)}
          detail={gsc.siteUrl ?? ("message" in gsc ? gsc.message : undefined)}
        />
        <StatusCard
          label="Rank tracking"
          status={sourceLabel(rankTracking.status)}
          detail={
            rankTracking.status === "not_configured"
              ? "No tracker is configured for this project."
              : "Latest stored ranking snapshots."
          }
        />
      </div>
      {ga4.hasLimitedData || ga4.warnings.length > 0 ? (
        <div className="alert alert-warning">
          <span className="text-sm">
            Google Analytics marked this report as limited
            {ga4.warnings.length > 0 ? ` (${ga4.warnings.join(", ")})` : ""}.
            Missing metrics are shown as dashes, not zeros.
          </span>
        </div>
      ) : null}
      {ga4.status !== "connected" && canManageConnection ? (
        <div className="max-w-2xl">
          <GoogleAnalyticsConnectionCard projectId={projectId} />
        </div>
      ) : null}
      {gsc.status !== "connected" && canManageConnection ? (
        <div className="max-w-2xl">
          <SearchConsoleConnectionCard projectId={projectId} />
        </div>
      ) : null}
      {ga4.status !== "connected" && !canManageConnection ? (
        <div className="alert alert-info max-w-2xl">
          Google Analytics has not been connected for this project. Ask the
          workspace owner to connect it.
        </div>
      ) : null}
      {gsc.status !== "connected" && !canManageConnection ? (
        <div className="alert alert-info max-w-2xl">
          Search Console has not been connected for this project. Ask the
          workspace owner to connect it.
        </div>
      ) : null}
      {rankTracking.status === "not_configured" ? (
        <div className="alert alert-info max-w-2xl">
          <span className="text-sm">
            Rank tracking is not configured, so keyword counts stay blank.{" "}
            <Link
              to="/p/$projectId/rank-tracking"
              params={{ projectId }}
              className="link"
            >
              Set up rank tracking
            </Link>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-4">
      <p className="text-xs uppercase tracking-wide text-base-content/50">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{status}</p>
      {detail ? (
        <p
          className="mt-1 truncate text-xs text-base-content/60"
          title={detail}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}
