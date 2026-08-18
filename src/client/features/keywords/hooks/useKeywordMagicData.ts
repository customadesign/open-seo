import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { captureClientEvent } from "@/client/lib/posthog";
import { LOCATIONS } from "@/client/features/keywords/utils";
import { parseKeywordInput } from "@/client/features/keywords/state/keywordControllerActions";
import {
  estimateKeywordMagic,
  getKeywordMagicPage,
  runKeywordMagic,
} from "@/serverFunctions/keywords";
import type { KeywordFilterValues } from "@/client/features/keywords/keywordResearchTypes";
import { parseIntentFilter } from "@/client/features/keywords/keywordResearchTypes";
import type { KeywordMagicMatchType } from "@/shared/keyword-magic";
import type { KeywordMagicSortField } from "@/types/keyword-magic";
import type { SortDir } from "@/client/features/keywords/components";
import { parseTerms } from "@/client/features/keywords/utils";

type AddSearchFn = (
  keyword: string,
  locationCode: number,
  locationName: string,
) => void;

export type KeywordMagicQueryInput = {
  projectId: string;
  keywordInput: string;
  locationCode: number | undefined;
  displayedLocationCode: number;
  clickstream: boolean;
  maxKeywords: 1000 | 5000 | 10000 | 20000;
  matchType: KeywordMagicMatchType;
  clusterId?: string;
  page: number;
  pageSize: 50 | 100 | 300 | 500;
  sortField: KeywordMagicSortField;
  sortDir: SortDir;
  filters: KeywordFilterValues;
  minWordCount?: string;
  maxWordCount?: string;
  serpFeatures?: string;
  runId?: string;
};

function optionalNumber(value: string | undefined): number | null | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function useKeywordMagicData(
  input: KeywordMagicQueryInput,
  addSearch: AddSearchFn,
) {
  const seed = parseKeywordInput(input.keywordInput)[0] ?? "";
  const hasSearched = seed.length > 0;

  const estimateQuery = useQuery({
    queryKey: [
      "keywordMagicEstimate",
      input.projectId,
      seed,
      input.locationCode,
      input.clickstream,
      input.maxKeywords,
    ],
    queryFn: () =>
      estimateKeywordMagic({
        data: {
          projectId: input.projectId,
          seed,
          locationCode: input.locationCode,
          clickstream: input.clickstream,
          maxKeywords: input.maxKeywords,
        },
      }),
    enabled: hasSearched,
    staleTime: 60_000,
    retry: false,
  });

  const runMutation = useMutation({
    mutationFn: (maxCostCredits?: number) =>
      runKeywordMagic({
        data: {
          projectId: input.projectId,
          seed,
          locationCode: input.locationCode,
          clickstream: input.clickstream,
          maxKeywords: input.maxKeywords,
          maxCostCredits,
        },
      }),
  });

  const activeRunId =
    runMutation.data?.id ?? estimateQuery.data?.runId ?? input.runId ?? null;
  const needsApproval =
    hasSearched &&
    estimateQuery.isSuccess &&
    !estimateQuery.data.cached &&
    !runMutation.data;

  const pageQuery = useQuery({
    queryKey: [
      "keywordMagicPage",
      input.projectId,
      activeRunId,
      input.matchType,
      input.clusterId,
      input.page,
      input.pageSize,
      input.sortField,
      input.sortDir,
      input.filters,
      input.minWordCount,
      input.maxWordCount,
      input.serpFeatures,
    ],
    queryFn: () =>
      getKeywordMagicPage({
        data: {
          projectId: input.projectId,
          runId: activeRunId!,
          matchType: input.matchType,
          clusterId: input.clusterId,
          includeTerms: parseTerms(input.filters.include),
          excludeTerms: parseTerms(input.filters.exclude),
          minVolume: optionalNumber(input.filters.minVol),
          maxVolume: optionalNumber(input.filters.maxVol),
          minCpc: optionalNumber(input.filters.minCpc),
          maxCpc: optionalNumber(input.filters.maxCpc),
          minDifficulty: optionalNumber(input.filters.minKd),
          maxDifficulty: optionalNumber(input.filters.maxKd),
          minWordCount: optionalNumber(input.minWordCount),
          maxWordCount: optionalNumber(input.maxWordCount),
          intents: parseIntentFilter(input.filters.intents),
          serpFeatures: parseTerms(input.serpFeatures ?? ""),
          page: input.page,
          pageSize: input.pageSize,
          sort: input.sortField,
          order: input.sortDir,
        },
      }),
    enabled: hasSearched && Boolean(activeRunId),
    staleTime: 60_000,
    retry: false,
  });

  const handledSuccessKeyRef = useRef<string | null>(null);
  const successKey = `${activeRunId}:${seed}`;
  useEffect(() => {
    if (!hasSearched || !pageQuery.isSuccess || !pageQuery.data) return;
    if (handledSuccessKeyRef.current === successKey) return;
    handledSuccessKeyRef.current = successKey;
    captureClientEvent("keyword_research:search_complete", {
      location_code: input.displayedLocationCode,
      search_mode: input.matchType,
      clickstream: input.clickstream,
      result_count: pageQuery.data.totalCount,
    });
    addSearch(
      seed,
      input.displayedLocationCode,
      LOCATIONS[input.displayedLocationCode] || "Unknown",
    );
  }, [
    addSearch,
    hasSearched,
    input.clickstream,
    input.displayedLocationCode,
    input.matchType,
    pageQuery.data,
    pageQuery.isSuccess,
    seed,
    successKey,
  ]);

  const researchError = useMemo(() => {
    if (!hasSearched) return null;
    const error =
      estimateQuery.error ?? runMutation.error ?? pageQuery.error ?? null;
    return error ? getStandardErrorMessage(error, "Research failed.") : null;
  }, [estimateQuery.error, hasSearched, pageQuery.error, runMutation.error]);

  const isLoading =
    hasSearched &&
    (estimateQuery.isPending ||
      runMutation.isPending ||
      (Boolean(activeRunId) && pageQuery.isPending));

  return {
    rows: (pageQuery.data?.rows ?? []).map((row) => ({
      ...row,
      trend: [],
    })),
    clusters: pageQuery.data?.clusters ?? [],
    totalCount: pageQuery.data?.totalCount ?? 0,
    hasMore: pageQuery.data?.hasMore ?? false,
    run: pageQuery.data?.run ?? runMutation.data ?? null,
    estimate: estimateQuery.data ?? null,
    needsApproval,
    hasSearched,
    isLoading,
    researchError,
    researchMutationError:
      estimateQuery.error ?? runMutation.error ?? pageQuery.error ?? null,
    lastSearchError: Boolean(researchError),
    lastSearchKeyword: seed,
    lastSearchLocationCode: input.displayedLocationCode,
    searchedKeyword: seed,
    approveAndRun: () => {
      const credits = estimateQuery.data?.costCredits;
      if (credits == null) return;
      runMutation.mutate(credits);
    },
    retryResearch: () => {
      void estimateQuery.refetch();
      if (activeRunId) void pageQuery.refetch();
    },
  };
}
