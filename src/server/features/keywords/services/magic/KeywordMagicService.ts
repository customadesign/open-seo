/* eslint-disable max-lines */
import { AppError } from "@/server/lib/errors";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { getKeywordDataProvider } from "@/shared/keyword-locations";
import {
  estimateKeywordMagicRunCredits,
  keywordMagicCostApprovalError,
  keywordMagicFingerprint,
  KEYWORD_MAGIC_DEFAULT_KEYWORDS,
  KEYWORD_MAGIC_TTL_MS,
  type KeywordMagicMatchType,
  type KeywordMagicPageSize,
} from "@/shared/keyword-magic";
import { normalizeIntent, normalizeKeyword } from "../research/helpers";
import { KeywordMagicRepository } from "../../repositories/KeywordMagicRepository";
import { clusterKeywords } from "./cluster-keywords";
import { fetchAdsMagicRows, fetchLabsMagicRows } from "./fetch-magic";
import { refreshKeywordMetricsForList } from "../research/refresh-metrics";
import { saveKeywords } from "../research/saved-keywords";
import type {
  KeywordMagicFilters,
  KeywordMagicPageResult,
  KeywordMagicRow,
  KeywordMagicRunSummary,
  KeywordMagicSortField,
} from "@/types/keyword-magic";
import type { KeywordIntent } from "@/types/keywords";

function toRunSummary(
  run: NonNullable<
    Awaited<ReturnType<typeof KeywordMagicRepository.getRunById>>
  >,
): KeywordMagicRunSummary {
  return {
    id: run.id,
    seed: run.seed,
    locationCode: run.locationCode,
    languageCode: run.languageCode,
    clickstream: run.clickstream,
    maxKeywords: run.maxKeywords,
    keywordCount: run.keywordCount,
    provider: run.provider,
    createdAt: run.createdAt,
    expiresAt: run.expiresAt,
  };
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

async function mapPageRows(
  rows: {
    keyword: {
      id: string;
      keyword: string;
      searchVolume: number | null;
      cpc: number | null;
      competition: number | null;
      keywordDifficulty: number | null;
      intent: string | null;
      wordCount: number;
      metricsUpdatedAt: string | null;
      clusterId: string | null;
    };
    clusterName: string | null;
  }[],
): Promise<KeywordMagicRow[]> {
  const features = await KeywordMagicRepository.listSerpFeaturesByKeywordIds(
    rows.map((row) => row.keyword.id),
  );
  return rows.map(({ keyword, clusterName }) => ({
    keyword: keyword.keyword,
    searchVolume: keyword.searchVolume,
    cpc: keyword.cpc,
    competition: keyword.competition,
    keywordDifficulty: keyword.keywordDifficulty,
    intent: normalizeIntent(keyword.intent),
    wordCount: keyword.wordCount,
    serpFeatures: features.get(keyword.id) ?? [],
    metricsUpdatedAt: keyword.metricsUpdatedAt,
    clusterId: keyword.clusterId,
    clusterName,
  }));
}

export async function estimateKeywordMagic(
  input: {
    projectId: string;
    seed: string;
    locationCode: number;
    languageCode: string;
    clickstream?: boolean;
    maxKeywords?: number;
  },
  _billingCustomer: BillingCustomerContext,
): Promise<{
  cached: boolean;
  runId: string | null;
  requests: number;
  costUsd: number;
  costCredits: number;
  provider: "labs" | "google_ads";
  maxKeywords: number;
}> {
  const seed = normalizeKeyword(input.seed);
  if (!seed) throw new AppError("VALIDATION_ERROR");
  const maxKeywords = input.maxKeywords ?? KEYWORD_MAGIC_DEFAULT_KEYWORDS;
  const clickstream = input.clickstream ?? false;
  const provider = getKeywordDataProvider(input.locationCode);
  const fingerprint = keywordMagicFingerprint({
    seed,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    clickstream: provider === "labs" ? clickstream : false,
    maxKeywords,
  });
  const existing = await KeywordMagicRepository.findReadyRun({
    projectId: input.projectId,
    fingerprint,
  });
  if (
    existing &&
    existing.status === "ready" &&
    !isExpired(existing.expiresAt)
  ) {
    return {
      cached: true,
      runId: existing.id,
      requests: 0,
      costUsd: 0,
      costCredits: 0,
      provider,
      maxKeywords,
    };
  }

  const hosted = await isHostedServerAuthMode();
  const estimate = estimateKeywordMagicRunCredits({
    maxKeywords,
    clickstream: provider === "labs" ? clickstream : false,
    provider,
    hosted,
  });
  return {
    cached: false,
    runId: null,
    ...estimate,
    provider,
    maxKeywords,
  };
}

export async function runKeywordMagic(
  input: {
    projectId: string;
    seed: string;
    locationCode: number;
    languageCode: string;
    clickstream?: boolean;
    maxKeywords?: number;
    maxCostCredits?: number;
  },
  billingCustomer: BillingCustomerContext,
): Promise<KeywordMagicRunSummary> {
  const estimate = await estimateKeywordMagic(input, billingCustomer);
  if (estimate.cached && estimate.runId) {
    const run = await KeywordMagicRepository.getRunById({
      projectId: input.projectId,
      runId: estimate.runId,
    });
    if (run) return toRunSummary(run);
  }

  if (estimate.costCredits > 0) {
    if (input.maxCostCredits == null || input.maxCostCredits <= 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        keywordMagicCostApprovalError(estimate.costCredits, 0),
      );
    }
    if (estimate.costCredits > input.maxCostCredits) {
      throw new AppError(
        "VALIDATION_ERROR",
        keywordMagicCostApprovalError(
          estimate.costCredits,
          input.maxCostCredits,
        ),
      );
    }
  }

  const seed = normalizeKeyword(input.seed);
  const maxKeywords = estimate.maxKeywords;
  const clickstream =
    estimate.provider === "labs" ? (input.clickstream ?? false) : false;
  const rows =
    estimate.provider === "google_ads"
      ? await fetchAdsMagicRows(
          {
            seed,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            maxKeywords,
            creditFeature: "keyword_research",
          },
          billingCustomer,
        )
      : await fetchLabsMagicRows(
          {
            seed,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            maxKeywords,
            clickstream,
            creditFeature: "keyword_research",
          },
          billingCustomer,
        );

  const clusters = clusterKeywords(
    rows.map((row) => ({
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      serpFeatures: row.serpFeatures,
    })),
  );
  const clusterIdByName = new Map(
    clusters.map((cluster, index) => [
      cluster.name,
      { id: crypto.randomUUID(), index, count: cluster.keywords.length },
    ]),
  );
  const clusterNameByKeyword = new Map<string, string>();
  for (const cluster of clusters) {
    for (const keyword of cluster.keywords) {
      clusterNameByKeyword.set(keyword, cluster.name);
    }
  }

  const fingerprint = keywordMagicFingerprint({
    seed,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    clickstream,
    maxKeywords,
  });
  const existingRun = await KeywordMagicRepository.findReadyRun({
    projectId: input.projectId,
    fingerprint,
  });
  const runId = existingRun?.id ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + KEYWORD_MAGIC_TTL_MS).toISOString();

  await KeywordMagicRepository.insertRun({
    id: runId,
    projectId: input.projectId,
    seed,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    clickstream,
    maxKeywords,
    fingerprint,
    provider: estimate.provider,
    keywordCount: rows.length,
    estimatedCostCredits: estimate.costCredits,
    expiresAt,
  });

  await KeywordMagicRepository.replaceRunContents({
    runId,
    clusters: clusters.map((cluster) => {
      const meta = clusterIdByName.get(cluster.name);
      return {
        id: meta?.id ?? crypto.randomUUID(),
        name: cluster.name,
        keywordCount: cluster.keywords.length,
        sortOrder: meta?.index ?? 0,
      };
    }),
    keywords: rows.map((row) => {
      const clusterName = clusterNameByKeyword.get(row.keyword) ?? "Other";
      return {
        ...row,
        id: crypto.randomUUID(),
        clusterId: clusterIdByName.get(clusterName)?.id ?? null,
        clusterName,
      };
    }),
  });

  return {
    id: runId,
    seed,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    clickstream,
    maxKeywords,
    keywordCount: rows.length,
    provider: estimate.provider,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
}

export async function getKeywordMagicPage(input: {
  projectId: string;
  runId: string;
  filters?: KeywordMagicFilters;
  page?: number;
  pageSize?: KeywordMagicPageSize;
  sort?: KeywordMagicSortField;
  order?: "asc" | "desc";
}): Promise<KeywordMagicPageResult> {
  const run = await KeywordMagicRepository.getRunById({
    projectId: input.projectId,
    runId: input.runId,
  });
  if (!run || isExpired(run.expiresAt)) {
    throw new AppError("NOT_FOUND");
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const filters = input.filters ?? {};
  const [listed, clusters] = await Promise.all([
    KeywordMagicRepository.listKeywordsPage({
      runId: run.id,
      filters,
      page,
      pageSize,
      sort: input.sort,
      order: input.order,
    }),
    KeywordMagicRepository.listClusters(run.id),
  ]);

  return {
    run: toRunSummary(run),
    rows: await mapPageRows(listed.rows),
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      keywordCount: cluster.keywordCount,
    })),
    totalCount: listed.totalCount,
    page,
    pageSize,
    hasMore: listed.hasMore,
    matchType: filters.matchType ?? "all",
  };
}

export async function exportKeywordMagic(input: {
  projectId: string;
  runId: string;
  filters?: KeywordMagicFilters;
  sort?: KeywordMagicSortField;
  order?: "asc" | "desc";
}): Promise<{ rows: KeywordMagicRow[] }> {
  const run = await KeywordMagicRepository.getRunById({
    projectId: input.projectId,
    runId: input.runId,
  });
  if (!run || isExpired(run.expiresAt)) {
    throw new AppError("NOT_FOUND");
  }
  const rows = await KeywordMagicRepository.listKeywordsForExport({
    runId: run.id,
    filters: input.filters ?? {},
    sort: input.sort,
    order: input.order,
  });
  return { rows: await mapPageRows(rows) };
}

export async function listKeywordMagicHistory(input: {
  projectId: string;
}): Promise<{ runs: KeywordMagicRunSummary[] }> {
  const runs = await KeywordMagicRepository.listHistory({
    projectId: input.projectId,
  });
  return {
    runs: runs.filter((run) => !isExpired(run.expiresAt)).map(toRunSummary),
  };
}

export async function saveKeywordMagicSelection(input: {
  projectId: string;
  runId: string;
  keywords: string[];
  tags?: string[];
  locationCode: number;
  languageCode: string;
}): Promise<{ success: boolean; savedKeywordIds: string[] }> {
  const rows = await KeywordMagicRepository.listKeywordsByValues({
    runId: input.runId,
    keywords: input.keywords.map(normalizeKeyword),
  });
  return saveKeywords({
    projectId: input.projectId,
    keywords: rows.map((row) => row.keyword),
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    tags: input.tags,
    metrics: rows.map((row) => ({
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      cpc: row.cpc,
      competition: row.competition,
      keywordDifficulty: row.keywordDifficulty,
      intent: normalizeIntent(row.intent),
    })),
  });
}

export async function refreshKeywordMagicMetrics(
  input: {
    projectId: string;
    runId: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
): Promise<{ updated: number }> {
  const normalized = input.keywords.map(normalizeKeyword).filter(Boolean);
  if (normalized.length === 0) return { updated: 0 };

  const { metrics } = await refreshKeywordMetricsForList(
    {
      projectId: input.projectId,
      keywords: normalized,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    },
    billingCustomer,
  );

  const rows = await KeywordMagicRepository.listKeywordsByValues({
    runId: input.runId,
    keywords: normalized,
  });
  const fetchedAt = new Date().toISOString();
  await KeywordMagicRepository.updateKeywordMetrics(
    rows.flatMap((row) => {
      const metric = metrics.get(row.keyword);
      if (!metric) return [];
      return [
        {
          id: row.id,
          searchVolume: metric.searchVolume,
          cpc: metric.cpc,
          competition: metric.competition,
          keywordDifficulty: metric.keywordDifficulty,
          intent: normalizeIntent(metric.intent),
          metricsUpdatedAt: fetchedAt,
        },
      ];
    }),
  );
  return { updated: metrics.size };
}

export type { KeywordMagicMatchType, KeywordIntent };
