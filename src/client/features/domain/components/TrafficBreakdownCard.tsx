import { useState, type FormEvent } from "react";
import {
  useDomainBrandTokenMutations,
  useDomainTrafficBreakdownQuery,
} from "@/client/features/domain/hooks/useDomainReportQueries";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type Props = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number | undefined;
};

export function TrafficBreakdownCard({
  projectId,
  domain,
  includeSubdomains,
  locationCode,
}: Props) {
  const [token, setToken] = useState("");
  const query = useDomainTrafficBreakdownQuery({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });
  const mutations = useDomainBrandTokenMutations({
    projectId,
    domain,
    includeSubdomains,
    locationCode,
  });

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const next = token.trim();
    if (!next) return;
    mutations.add.mutate(next, { onSuccess: () => setToken("") });
  };

  if (query.isLoading) {
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body p-4 text-sm text-base-content/60">
          Loading branded traffic split…
        </div>
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="alert alert-error">
        <span>
          {getStandardErrorMessage(
            query.error,
            "Could not load branded split.",
          )}
        </span>
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-base-content/60">
            Branded vs non-branded
          </p>
          <p className="text-sm text-base-content/70">
            A keyword is branded when it contains a domain-derived token or a
            token you add. Derived tokens cannot be removed.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-base-content/60">Branded</p>
            <p className="font-semibold">
              {formatRounded(data.branded.traffic)} traffic ·{" "}
              {formatNumber(data.branded.keywordCount)} keywords
            </p>
          </div>
          <div>
            <p className="text-base-content/60">Non-branded</p>
            <p className="font-semibold">
              {formatRounded(data.nonBranded.traffic)} traffic ·{" "}
              {formatNumber(data.nonBranded.keywordCount)} keywords
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.brandTokens.derived.map((item) => (
            <span key={`derived:${item}`} className="badge badge-ghost">
              {item}
            </span>
          ))}
          {data.brandTokens.user.map((item) => (
            <button
              key={`user:${item}`}
              type="button"
              className="badge badge-outline gap-1"
              onClick={() => mutations.remove.mutate(item)}
            >
              {item} ×
            </button>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={handleAdd}>
          <input
            className="input input-bordered input-sm flex-1"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Add a brand token"
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={mutations.add.isPending}
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
