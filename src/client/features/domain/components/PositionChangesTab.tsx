import { useMemo, useState } from "react";
import { useDomainPositionChangesQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
import {
  ReportErrorState,
  ReportLoadingState,
} from "@/client/features/domain/components/ReportLoadingState";
import { formatNumber } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import type { PositionChangeKind } from "@/server/features/domain/services/domainKeywordMapper";

type Props = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
};

const CHANGE_FILTERS: Array<{ id: PositionChangeKind | "all"; label: string }> =
  [
    { id: "all", label: "All" },
    { id: "new", label: "New" },
    { id: "lost", label: "Lost" },
    { id: "improved", label: "Improved" },
    { id: "declined", label: "Declined" },
  ];

export function PositionChangesTab({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
}: Props) {
  const [filter, setFilter] = useState<PositionChangeKind | "all">("all");
  const query = useDomainPositionChangesQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });

  const rows = useMemo(() => {
    const keywords = query.data?.keywords ?? [];
    return filter === "all"
      ? keywords
      : keywords.filter((row) => row.change === filter);
  }, [filter, query.data?.keywords]);

  if (query.isLoading) {
    return <ReportLoadingState label="Loading position changes…" />;
  }
  if (query.error) {
    return (
      <ReportErrorState
        message={getStandardErrorMessage(query.error, "Lookup failed.")}
      />
    );
  }

  const data = query.data;
  if (!data) return null;

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-base-content/70">
        Keyword-level moves from DataForSEO&apos;s last two checks
        {data.previousDate || data.currentDate
          ? ` (${data.previousDate ?? "previous"} → ${data.currentDate ?? "current"})`
          : ""}
        . Limited to the top {data.sampleSize} keywords by traffic plus lost
        rankings from that same set. Re-sorting here does not call the provider
        again.
      </p>
      <div className="flex flex-wrap gap-2">
        {CHANGE_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn btn-sm ${filter === item.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            {item.id !== "all" ? ` (${data.counts[item.id]})` : ""}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Change</th>
              <th>Previous</th>
              <th>Current</th>
              <th>Volume</th>
              <th>Traffic</th>
              <th>Est. impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-base-content/60">
                  No keywords in this set.
                </td>
              </tr>
            ) : (
              rows.slice(0, 200).map((row) => (
                <tr key={`${row.change}:${row.keyword}`}>
                  <td>{row.keyword}</td>
                  <td className="capitalize">{row.change}</td>
                  <td>{formatNumber(row.previousPosition)}</td>
                  <td>{formatNumber(row.currentPosition)}</td>
                  <td>{formatNumber(row.searchVolume)}</td>
                  <td>{formatNumber(row.traffic)}</td>
                  <td>{formatNumber(row.trafficImpact)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
