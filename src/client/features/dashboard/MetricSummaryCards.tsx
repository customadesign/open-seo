import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CardShell,
  DeltaValue,
  EmptyCardBody,
  formatDay,
  moreDetailsClass,
  Stat,
} from "@/client/features/dashboard/cardParts";
import {
  metricForViewer,
  needsMetricRefresh,
  pollQueuedAiBaseline,
} from "@/client/features/dashboard/metricRefresh";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  getDashboardMetrics,
  refreshDashboardMetrics,
} from "@/serverFunctions/dashboard";
import type {
  DashboardMetric,
  DashboardMetricKey,
  DashboardMetricTarget,
} from "@/server/features/dashboard/services/dashboardMetricTypes";

// The seven SEMrush-style summary cards. Fixed order, one shape each: what the
// number is, how it moved, where it came from and when. A metric with no data
// says so — none of these cards ever renders a missing value as zero.

/** What the number counts, under the card's title. */
const VALUE_LABELS: Record<DashboardMetricKey, string> = {
  ai_visibility: "Share of AI answers",
  mentions: "Brand mentions",
  site_health: "Health score",
  visibility: "Share of click potential",
  organic_traffic: "Est. monthly visits",
  organic_keywords: "Ranked keywords",
  backlinks: "Total backlinks",
};

function formatValue(metric: DashboardMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "score") return String(Math.round(metric.value));
  return formatCount(metric.value);
}

function MetricLink({
  target,
  projectId,
  label,
  className,
}: {
  target: DashboardMetricTarget;
  projectId: string;
  label: string;
  className: string;
}) {
  // A switch, not a computed path: TanStack's typed links turn a renamed route
  // into a compile error instead of a dead card action.
  switch (target) {
    case "audit":
      return (
        <Link
          to="/p/$projectId/audit"
          params={{ projectId }}
          className={className}
        >
          {label}
        </Link>
      );
    case "rank-tracking":
      return (
        <Link
          to="/p/$projectId/rank-tracking"
          params={{ projectId }}
          className={className}
        >
          {label}
        </Link>
      );
    case "domain":
      return (
        <Link
          to="/p/$projectId/domain"
          params={{ projectId }}
          className={className}
        >
          {label}
        </Link>
      );
    case "backlinks":
      return (
        <Link
          to="/p/$projectId/backlinks"
          params={{ projectId }}
          className={className}
        >
          {label}
        </Link>
      );
    case "settings":
      return (
        <Link
          to="/p/$projectId/settings"
          params={{ projectId }}
          className={className}
        >
          {label}
        </Link>
      );
    case "billing":
      return (
        <Link to="/billing" className={className}>
          {label}
        </Link>
      );
  }
}

function MetricCard({
  metric,
  projectId,
}: {
  metric: DashboardMetric;
  projectId: string;
}) {
  const stamp = [
    metric.sourceLabel,
    metric.estimated ? "estimated" : null,
    metric.capturedAt ? formatDay(metric.capturedAt) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <CardShell
      title={metric.label}
      stamp={stamp}
      action={
        metric.status === "ready" && metric.target ? (
          <MetricLink
            target={metric.target}
            projectId={projectId}
            label="More details"
            className={moreDetailsClass}
          />
        ) : null
      }
    >
      {metric.status === "ready" ? (
        <Stat
          label={VALUE_LABELS[metric.key]}
          value={formatValue(metric)}
          sub={<DeltaValue delta={metric.delta} kind={metric.deltaKind} />}
        />
      ) : (
        <EmptyCardBody
          message={metric.note ?? "No data yet."}
          cta={
            metric.status === "setup" && metric.target ? (
              <MetricLink
                target={metric.target}
                projectId={projectId}
                label="Set this up"
                className="btn btn-primary btn-sm"
              />
            ) : metric.target ? (
              <MetricLink
                target={metric.target}
                projectId={projectId}
                label="Open"
                className="btn btn-ghost btn-sm"
              />
            ) : null
          }
        />
      )}
    </CardShell>
  );
}

export function MetricSummaryCards({
  projectId,
  canUseProjectTools,
}: {
  projectId: string;
  canUseProjectTools: boolean;
}) {
  const queryClient = useQueryClient();
  const metricsQuery = useQuery({
    queryKey: ["dashboardMetrics", projectId],
    queryFn: () => getDashboardMetrics({ data: { projectId } }),
  });
  const pollCleanupRef = useRef<(() => void) | null>(null);

  const refreshMutation = useMutation({
    mutationFn: () => refreshDashboardMetrics({ data: { projectId } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ["dashboardMetrics", projectId],
      });
      if (!result.aiRunQueued) return;

      pollCleanupRef.current?.();
      pollCleanupRef.current = pollQueuedAiBaseline({
        refetch: async () => (await metricsQuery.refetch()).data ?? [],
      });
    },
  });

  useEffect(
    () => () => {
      pollCleanupRef.current?.();
      pollCleanupRef.current = null;
    },
    [],
  );

  // Fire once per page view. The server re-checks freshness for every source,
  // so a stray double-fire costs nothing. Client-role accounts can read the
  // cards but never set shouldRefresh or trigger metered work.
  const refreshFiredRef = useRef(false);
  const metrics = metricsQuery.data;
  const shouldRefresh =
    canUseProjectTools && metrics !== undefined && needsMetricRefresh(metrics);
  useEffect(() => {
    if (!shouldRefresh || refreshFiredRef.current) return;
    refreshFiredRef.current = true;
    refreshMutation.mutate();
  }, [shouldRefresh, refreshMutation]);

  if (metricsQuery.isPending) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-busy
        aria-label="Loading summary metrics"
      >
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="skeleton h-32" />
        ))}
      </div>
    );
  }

  if (!metrics) {
    return (
      <p className="text-sm text-base-content/60">
        Couldn&rsquo;t load your summary metrics. Try again shortly.
      </p>
    );
  }

  const visibleMetrics = metrics.map((metric) =>
    metricForViewer(metric, canUseProjectTools),
  );

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visibleMetrics.map((metric) => (
        <MetricCard key={metric.key} metric={metric} projectId={projectId} />
      ))}
    </div>
  );
}
