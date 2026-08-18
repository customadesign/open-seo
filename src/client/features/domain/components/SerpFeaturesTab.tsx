import { useDomainSerpFeaturesQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
import {
  ReportErrorState,
  ReportLoadingState,
} from "@/client/features/domain/components/ReportLoadingState";
import { formatNumber } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type Props = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
};

export function SerpFeaturesTab({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
}: Props) {
  const query = useDomainSerpFeaturesQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });

  if (query.isLoading) {
    return <ReportLoadingState label="Loading SERP features…" />;
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
        Features present on this domain&apos;s ranking keywords, and how often
        the domain occupies that feature. Current values come from the top{" "}
        {data.sampleSize} keywords. Monthly trend rows are stored snapshots (6
        months, 8 domains per project).
      </p>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Triggered</th>
            <th>Occupied</th>
          </tr>
        </thead>
        <tbody>
          {data.current.map((row) => (
            <tr key={row.feature}>
              <td>{row.feature}</td>
              <td>{formatNumber(row.triggeredCount)}</td>
              <td>{formatNumber(row.occupiedCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.trend.length > 1 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Monthly snapshots</h3>
          {data.trend.map((month) => (
            <div key={month.periodKey} className="text-sm">
              <p className="font-medium">{month.periodKey}</p>
              <p className="text-base-content/70">
                {month.features
                  .map(
                    (feature) =>
                      `${feature.feature}: ${feature.occupiedCount}/${feature.triggeredCount}`,
                  )
                  .join(" · ")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-base-content/60">
          Trend appears after this report has been opened in more than one
          month.
        </p>
      )}
    </div>
  );
}
