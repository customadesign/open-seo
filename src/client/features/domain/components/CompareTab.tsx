import { useMemo, useState, type FormEvent } from "react";
import { useDomainCompareQuery } from "@/client/features/domain/hooks/useDomainReportQueries";
import {
  ReportErrorState,
  ReportLoadingState,
} from "@/client/features/domain/components/ReportLoadingState";
import {
  formatCurrency,
  formatNumber,
  formatRounded,
  normalizeDomainTarget,
} from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type Props = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
  compareDomains: string[];
  onCompareDomainsChange: (domains: string[]) => void;
};

export function CompareTab({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
  compareDomains,
  onCompareDomainsChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const domains = useMemo(
    () =>
      [domain, ...compareDomains.filter((item) => item !== domain)].slice(0, 5),
    [compareDomains, domain],
  );
  const extraCount = Math.max(0, domains.length - 1);
  const query = useDomainCompareQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
    domains,
  });

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeDomainTarget(draft);
    if (!next || next === domain || compareDomains.includes(next)) {
      setDraft("");
      return;
    }
    onCompareDomainsChange([...compareDomains, next].slice(0, 4));
    setDraft("");
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-base-content/70">
        Compare up to 5 domains in one bulk lookup (traffic and keyword count).
        Traffic cost is not in that endpoint, so it stays on each domain&apos;s
        own overview. Cached for 12 hours so changing the table sort does not
        re-bill.
      </p>
      {extraCount > 0 ? (
        <div className="alert alert-info text-sm">
          This comparison looks up {domains.length} domains in a single
          DataForSEO bulk request. Additional domains you have not compared
          before will spend domain-overview credits.
        </div>
      ) : null}
      <form className="flex flex-wrap gap-2" onSubmit={handleAdd}>
        <input
          className="input input-bordered input-sm w-64"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="competitor.com"
        />
        <button
          type="submit"
          className="btn btn-sm"
          disabled={compareDomains.length >= 4}
        >
          Add domain
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {compareDomains.map((item) => (
          <button
            key={item}
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() =>
              onCompareDomainsChange(
                compareDomains.filter((domainName) => domainName !== item),
              )
            }
          >
            {item} ×
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <ReportLoadingState label="Comparing domains…" />
      ) : query.error ? (
        <ReportErrorState
          message={getStandardErrorMessage(query.error, "Lookup failed.")}
        />
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Est. traffic</th>
              <th>Keywords</th>
              <th>Traffic cost</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.domains ?? []).map((row) => (
              <tr key={row.domain}>
                <td>{row.domain}</td>
                <td>{formatRounded(row.organicTraffic)}</td>
                <td>{formatNumber(row.organicKeywords)}</td>
                <td>{formatCurrency(row.trafficCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
