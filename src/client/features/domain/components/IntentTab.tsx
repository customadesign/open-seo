import { useDomainIntentQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
import { TrafficBreakdownCard } from "@/client/features/domain/components/TrafficBreakdownCard";
import {
  ReportErrorState,
  ReportLoadingState,
} from "@/client/features/domain/components/ReportLoadingState";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type Props = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
};

export function IntentTab({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
}: Props) {
  const query = useDomainIntentQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });

  if (query.isLoading) {
    return <ReportLoadingState label="Loading intent split…" />;
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
    <div className="p-4 space-y-3">
      <p className="text-sm text-base-content/70">
        Intent buckets from DataForSEO&apos;s main_intent on the top{" "}
        {data.sampleSize} ranking keywords by traffic. Unclassified keywords
        have no intent in the provider response.
      </p>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Intent</th>
            <th>Keywords</th>
            <th>Est. traffic</th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((bucket) => (
            <tr key={bucket.intent}>
              <td className="capitalize">{bucket.intent}</td>
              <td>{formatNumber(bucket.keywordCount)}</td>
              <td>{formatRounded(bucket.traffic)}</td>
            </tr>
          ))}
          <tr>
            <td>Unclassified</td>
            <td>{formatNumber(data.unclassified)}</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
      <TrafficBreakdownCard
        projectId={projectId}
        domain={domain}
        includeSubdomains={includeSubdomains}
        locationCode={locationCode}
      />
    </div>
  );
}
