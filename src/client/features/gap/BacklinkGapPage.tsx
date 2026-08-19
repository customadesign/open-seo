import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownUp, Download, Play } from "lucide-react";
import { toast } from "sonner";
import { getProjects } from "@/serverFunctions/projects";
import { estimateBacklinkGap, runBacklinkGap } from "@/serverFunctions/gap";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { buildCsv, downloadCsv } from "@/client/lib/csv";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { MAX_BACKLINK_GAP_COMPETITORS } from "@/shared/gap";
import type { BacklinkGapSearchParams } from "@/types/schemas/gap";
import type { BacklinkGapRow } from "@/server/features/gap/services/BacklinkGapService";

type Props = {
  projectId: string;
  search: BacklinkGapSearchParams;
  navigate: (args: {
    search: (prev: BacklinkGapSearchParams) => BacklinkGapSearchParams;
    replace?: boolean;
  }) => void;
};

type SortKey = "rank" | "competitors";

export function BacklinkGapPage({ projectId, search, navigate }: Props) {
  const hosted = isHostedClientAuthMode();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const [baseDomain, setBaseDomain] = useState(
    search.base || project?.domain || "",
  );
  const [competitors, setCompetitors] = useState(
    splitCompetitors(search.competitors, MAX_BACKLINK_GAP_COMPETITORS),
  );
  const [sortKey, setSortKey] = useState<SortKey>("rank");

  useEffect(() => {
    if (!search.base && project?.domain && !baseDomain) {
      setBaseDomain(project.domain);
    }
  }, [baseDomain, project?.domain, search.base]);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const compareInput = {
    projectId,
    baseDomain,
    competitorDomains: competitors.filter((domain) => domain.trim().length > 0),
  };

  const estimateMutation = useMutation({
    mutationFn: () => estimateBacklinkGap({ data: compareInput }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not estimate")),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      runBacklinkGap({
        data: {
          ...compareInput,
          maxCostCredits: estimateMutation.data?.costCredits ?? 0,
        },
      }),
    onSuccess: () => toast.success("Backlink gap ready"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not run comparison")),
  });

  const rows = useMemo(() => {
    return (runMutation.data?.rows ?? []).toSorted((left, right) =>
      compareRows(left, right, sortKey, sortDir),
    );
  }, [runMutation.data?.rows, sortDir, sortKey]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    navigate({
      search: () => ({
        base: baseDomain || undefined,
        competitors: competitors.filter(Boolean).join(",") || undefined,
      }),
      replace: true,
    });
    estimateMutation.reset();
    runMutation.reset();
    estimateMutation.mutate();
  }

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortDir((value) => (value === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(next);
    setSortDir("desc");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Backlink Gap</h1>
        <p className="text-sm text-base-content/60">
          Find referring domains that link to competitors but not to your site.
          Review the estimate before running.
        </p>
      </div>

      <form
        className="card border border-base-300 bg-base-100"
        onSubmit={onSubmit}
      >
        <div className="card-body gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="form-control">
              <span className="label-text mb-1">Base domain</span>
              <input
                className="input input-bordered"
                value={baseDomain}
                onChange={(event) => setBaseDomain(event.target.value)}
                placeholder="example.com"
              />
            </label>
            {competitors.map((value, index) => (
              <label className="form-control" key={index}>
                <span className="label-text mb-1">
                  Competitor {index + 1}
                  {index === 0 ? "" : " (optional)"}
                </span>
                <input
                  className="input input-bordered"
                  value={value}
                  onChange={(event) => {
                    const next = [...competitors];
                    next[index] = event.target.value;
                    setCompetitors(next);
                  }}
                  placeholder="competitor.com"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="btn"
              disabled={estimateMutation.isPending || runMutation.isPending}
            >
              Review estimate
            </button>
            <button
              type="button"
              className="btn btn-primary gap-1"
              disabled={!estimateMutation.data || runMutation.isPending}
              onClick={() => runMutation.mutate()}
            >
              <Play className="size-3.5" /> Run approved estimate
            </button>
          </div>
          {estimateMutation.data ? (
            <div className="alert text-sm">
              <span>
                {estimateMutation.data.domainCount} domains,{" "}
                {estimateMutation.data.cachedDomainCount} already cached,{" "}
                {estimateMutation.data.billedDomainCount} will be billed. Cap:{" "}
                <strong>
                  ${estimateMutation.data.costUsd.toFixed(4)}
                  {hosted
                    ? ` (${estimateMutation.data.costCredits} credits)`
                    : ""}
                </strong>
                .
              </span>
            </div>
          ) : null}
        </div>
      </form>

      {runMutation.data ? (
        <section className="card border border-base-300 bg-base-100">
          <div className="card-body gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm gap-1"
                onClick={() =>
                  downloadCsv(
                    `backlink-gap-${runMutation.data?.baseDomain}.csv`,
                    buildCsv(
                      [
                        "referring domain",
                        "rank",
                        "first seen",
                        "competitors linked",
                        "competitor domains",
                      ],
                      rows.map((row) => [
                        row.referringDomain,
                        row.rank,
                        row.firstSeen,
                        row.competitorCount,
                        row.competitorDomains.join(", "),
                      ]),
                    ),
                  )
                }
              >
                <Download className="size-3.5" /> Export CSV
              </button>
              <span className="self-center text-xs text-base-content/60">
                {rows.length} referring domains
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-base-300">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Referring domain</th>
                    <th>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={() => toggleSort("rank")}
                      >
                        Authority <ArrowDownUp className="size-3" />
                      </button>
                    </th>
                    <th>First seen</th>
                    <th>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={() => toggleSort("competitors")}
                      >
                        Competitors <ArrowDownUp className="size-3" />
                      </button>
                    </th>
                    <th>Links to</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.referringDomain}>
                      <td>{row.referringDomain}</td>
                      <td>{row.rank ?? "—"}</td>
                      <td>{row.firstSeen ?? "—"}</td>
                      <td>{row.competitorCount}</td>
                      <td>{row.competitorDomains.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function compareRows(
  left: BacklinkGapRow,
  right: BacklinkGapRow,
  sortKey: SortKey,
  sortDir: "asc" | "desc",
) {
  const direction = sortDir === "asc" ? 1 : -1;
  if (sortKey === "competitors") {
    return (left.competitorCount - right.competitorCount) * direction;
  }
  return ((left.rank ?? -1) - (right.rank ?? -1)) * direction;
}

function splitCompetitors(value: string | undefined, max: number) {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from({ length: max }, (_, index) => parsed[index] ?? "");
}
