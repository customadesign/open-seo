import { useDomainCompetitorsQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
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

export function CompetitorsTab({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
}: Props) {
  const query = useDomainCompetitorsQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });

  if (query.isLoading) {
    return <ReportLoadingState label="Loading competitors…" />;
  }
  if (query.error) {
    return (
      <ReportErrorState
        message={getStandardErrorMessage(query.error, "Lookup failed.")}
      />
    );
  }

  const competitors = query.data?.competitors ?? [];
  const maxKeywords = Math.max(
    ...competitors.map((row) => row.organicKeywords ?? 0),
    1,
  );
  const maxTraffic = Math.max(
    ...competitors.map((row) => row.organicTraffic ?? 0),
    1,
  );

  return (
    <div className="p-4 space-y-6">
      <p className="text-sm text-base-content/70">
        Competing domains ranked by shared keywords. Competition level is shared
        keywords divided by this domain&apos;s overlapping-keyword count. Large
        generic sites are excluded.
      </p>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Common keywords</th>
              <th>Competition</th>
              <th>Avg. position</th>
              <th>Keywords</th>
              <th>Est. traffic</th>
            </tr>
          </thead>
          <tbody>
            {competitors.map((row) => (
              <tr key={row.domain}>
                <td>{row.domain}</td>
                <td>{formatNumber(row.commonKeywords)}</td>
                <td>
                  {row.competitionLevel == null
                    ? "-"
                    : `${Math.round(row.competitionLevel * 100)}%`}
                </td>
                <td>{formatNumber(row.avgPosition)}</td>
                <td>{formatNumber(row.organicKeywords)}</td>
                <td>{formatRounded(row.organicTraffic)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">
          Keyword count vs estimated traffic
        </h3>
        <div className="relative h-64 rounded-lg border border-base-300 bg-base-200/40">
          {competitors.slice(0, 25).map((row) => {
            const left = ((row.organicKeywords ?? 0) / maxKeywords) * 90 + 4;
            const bottom = ((row.organicTraffic ?? 0) / maxTraffic) * 80 + 8;
            return (
              <span
                key={row.domain}
                className="absolute text-[10px] leading-none text-base-content/80"
                style={{ left: `${left}%`, bottom: `${bottom}%` }}
                title={`${row.domain}: ${row.organicKeywords ?? 0} keywords, ${row.organicTraffic ?? 0} traffic`}
              >
                {row.domain}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
