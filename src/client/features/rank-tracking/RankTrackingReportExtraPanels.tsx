import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getRankCompetitorsReport,
  getRankVisibilityReport,
} from "@/serverFunctions/rank-tracking";
import { formatVisibilityContribution } from "@/shared/rank-tracking-visibility";
import {
  EmptyState,
  formatPosition,
  formatSigned,
  LoadingState,
  ReportTable,
} from "./RankTrackingReportUi";

export function CompetitorsReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankCompetitors", projectId, configId, device],
    queryFn: () =>
      getRankCompetitorsReport({
        data: { projectId, configId, device },
      }),
  });

  if (isLoading) return <LoadingState />;
  return (
    <EmptyState>
      {data?.reason === "serp_results_not_stored"
        ? "Competitor domains are not stored on rank snapshots — each check keeps only this domain’s ranking URL. No competitor list exists on the tracker, so there is nothing to add."
        : "Competitor discovery is not available from stored snapshots."}
    </EmptyState>
  );
}

export function VisibilityReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankVisibility", projectId, configId, device],
    queryFn: () =>
      getRankVisibilityReport({
        data: { projectId, configId, device },
      }),
  });

  const movers = useMemo(
    () =>
      (data?.contributions ?? []).filter(
        (row) => Math.abs(row.contribution) >= 0.01,
      ),
    [data],
  );

  if (isLoading) return <LoadingState />;
  if (!data || movers.length === 0) {
    return (
      <EmptyState>
        Visibility attribution needs search volume and at least two checks.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          Visibility{" "}
          <strong>
            {data.visibility == null ? "—" : `${data.visibility.toFixed(2)}%`}
          </strong>
        </span>
        <span>
          Change <strong>{formatSigned(data.delta, 2)}</strong>
        </span>
      </div>
      {data.summary.length > 0 ? (
        <p className="text-sm">{data.summary.join(", ")}</p>
      ) : null}
      <ReportTable
        headers={["Keyword", "Now", "Previous", "Contribution"]}
        rows={movers.map((row) => [
          row.keyword,
          formatPosition(row.position),
          formatPosition(row.previousPosition),
          formatVisibilityContribution(row.keyword, row.contribution).replace(
            `${row.keyword} `,
            "",
          ),
        ])}
      />
    </div>
  );
}
