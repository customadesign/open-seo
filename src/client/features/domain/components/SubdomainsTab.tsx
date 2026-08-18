import { useDomainSubdomainsQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
import {
  ReportErrorState,
  ReportLoadingState,
} from "@/client/features/domain/components/ReportLoadingState";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type Props = {
  projectId: string;
  domain: string;
  locationCode: number | undefined;
};

export function SubdomainsTab({ projectId, domain, locationCode }: Props) {
  const query = useDomainSubdomainsQuery({
    projectId,
    domain,
    includeSubdomains: true,
    locationCode,
  });

  if (query.isLoading) {
    return <ReportLoadingState label="Loading subdomains…" />;
  }
  if (query.error) {
    return (
      <ReportErrorState
        message={getStandardErrorMessage(query.error, "Lookup failed.")}
      />
    );
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-base-content/70">
        Organic traffic and keyword count for each subdomain DataForSEO reports
        for this host.
      </p>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Subdomain</th>
            <th>Est. traffic</th>
            <th>Keywords</th>
          </tr>
        </thead>
        <tbody>
          {(query.data?.subdomains ?? []).map((row) => (
            <tr key={row.subdomain}>
              <td>{row.subdomain}</td>
              <td>{formatRounded(row.organicTraffic)}</td>
              <td>{formatNumber(row.organicKeywords)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
