import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { getProjects } from "@/serverFunctions/projects";
import { saveKeywords } from "@/serverFunctions/keywords";
import { estimateKeywordGap, runKeywordGap } from "@/serverFunctions/gap";
import { LocationSelect } from "@/client/components/LocationSelect";
import { LABS_LOCATION_OPTIONS } from "@/client/features/keywords/locations";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { MAX_KEYWORD_GAP_COMPETITORS } from "@/shared/gap";
import type { KeywordGapSearchParams } from "@/types/schemas/gap";
import {
  filterKeywordGapRows,
  KeywordGapResults,
} from "@/client/features/gap/KeywordGapResults";

type Props = {
  projectId: string;
  search: KeywordGapSearchParams;
  navigate: (args: {
    search: (prev: KeywordGapSearchParams) => KeywordGapSearchParams;
    replace?: boolean;
  }) => void;
};

export function KeywordGapPage({ projectId, search, navigate }: Props) {
  const hosted = isHostedClientAuthMode();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const defaultBase = search.base || project?.domain || "";
  const [baseDomain, setBaseDomain] = useState(defaultBase);
  const [competitors, setCompetitors] = useState(
    splitCompetitors(search.competitors, MAX_KEYWORD_GAP_COMPETITORS),
  );
  const [includeSubdomains, setIncludeSubdomains] = useState(
    search.subdomains ?? true,
  );
  const [locationCode, setLocationCode] = useState(
    search.loc ?? project?.locationCode ?? 2840,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!search.base && project?.domain && !baseDomain) {
      setBaseDomain(project.domain);
    }
    if (!search.loc && project?.locationCode) {
      setLocationCode(project.locationCode);
    }
  }, [
    baseDomain,
    project?.domain,
    project?.locationCode,
    search.base,
    search.loc,
  ]);

  const compareInput = {
    projectId,
    baseDomain,
    competitorDomains: competitors.filter((domain) => domain.trim().length > 0),
    includeSubdomains,
    locationCode,
  };

  const estimateMutation = useMutation({
    mutationFn: () => estimateKeywordGap({ data: compareInput }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not estimate")),
  });
  const runMutation = useMutation({
    mutationFn: () =>
      runKeywordGap({
        data: {
          ...compareInput,
          maxCostCredits: estimateMutation.data?.costCredits ?? 0,
        },
      }),
    onSuccess: () => {
      setSelected(new Set());
      toast.success("Keyword gap ready");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not run comparison")),
  });
  const saveMutation = useMutation({
    mutationFn: (keywords: string[]) =>
      saveKeywords({
        data: {
          projectId,
          keywords,
          locationCode,
          metrics: (runMutation.data?.rows ?? [])
            .filter((row) => keywords.includes(row.keyword))
            .map((row) => ({
              keyword: row.keyword,
              searchVolume: row.searchVolume,
              cpc: row.cpc,
              keywordDifficulty: row.keywordDifficulty,
              intent: normalizeIntent(row.intent),
            })),
        },
      }),
    onSuccess: () => toast.success("Saved selected keywords"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save keywords")),
  });

  const results = runMutation.data;
  const domains = results
    ? [results.baseDomain, ...(results.competitorDomains ?? [])].filter(
        (domain): domain is string => Boolean(domain),
      )
    : [];
  const visibleRows = useMemo(
    () => filterKeywordGapRows(results?.rows ?? [], search),
    [results?.rows, search],
  );

  const selectedRows = useMemo(
    () => visibleRows.filter((row) => selected.has(row.keyword)),
    [visibleRows, selected],
  );

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    persistSearch();
    estimateMutation.reset();
    runMutation.reset();
    estimateMutation.mutate();
  }

  function persistSearch() {
    navigate({
      search: (prev) => ({
        ...prev,
        base: baseDomain || undefined,
        competitors: competitors.filter(Boolean).join(",") || undefined,
        subdomains: includeSubdomains ? undefined : false,
        loc: locationCode,
      }),
      replace: true,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Keyword Gap</h1>
        <p className="text-sm text-base-content/60">
          Compare ranked keywords for your domain against up to four
          competitors. Review the estimate before running so a 5-domain
          comparison cannot spend silently.
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
            <label className="form-control">
              <span className="label-text mb-1">Location</span>
              <LocationSelect
                value={locationCode}
                options={LABS_LOCATION_OPTIONS}
                onChange={setLocationCode}
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
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={includeSubdomains}
              onChange={(event) => setIncludeSubdomains(event.target.checked)}
            />
            <span className="label-text">Include subdomains</span>
          </label>
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
              disabled={
                !estimateMutation.data ||
                runMutation.isPending ||
                estimateMutation.isPending
              }
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

      {results ? (
        <KeywordGapResults
          baseDomain={results.baseDomain}
          domains={domains}
          rows={visibleRows}
          search={search}
          selected={selected}
          saving={saveMutation.isPending}
          onFilterChange={(update) =>
            navigate({
              search: (prev) => ({ ...prev, ...update }),
              replace: true,
            })
          }
          onSave={() =>
            saveMutation.mutate(selectedRows.map((row) => row.keyword))
          }
          onSelectAll={(checked) =>
            setSelected(
              checked
                ? new Set(visibleRows.map((row) => row.keyword))
                : new Set(),
            )
          }
          onToggle={(keyword, checked) => {
            const next = new Set(selected);
            if (checked) next.add(keyword);
            else next.delete(keyword);
            setSelected(next);
          }}
        />
      ) : null}
    </div>
  );
}

function splitCompetitors(value: string | undefined, max: number) {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from({ length: max }, (_, index) => parsed[index] ?? "");
}

function normalizeIntent(intent: string | null) {
  if (
    intent === "informational" ||
    intent === "commercial" ||
    intent === "transactional" ||
    intent === "navigational" ||
    intent === "unknown"
  ) {
    return intent;
  }
  return intent ? "unknown" : null;
}
