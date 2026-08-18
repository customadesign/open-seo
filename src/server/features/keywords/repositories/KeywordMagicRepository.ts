/* eslint-disable max-lines */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  keywordMagicClusters,
  keywordMagicKeywords,
  keywordMagicRuns,
  keywordMagicSerpFeatures,
} from "@/db/schema";
import { computeHasMore } from "@/server/features/domain/services/pagination";
import type {
  KeywordMagicFilters,
  KeywordMagicSortField,
} from "@/types/keyword-magic";
import type { KeywordMagicMatchType } from "@/shared/keyword-magic";

type RunRecord = typeof keywordMagicRuns.$inferSelect;
type KeywordRecord = typeof keywordMagicKeywords.$inferSelect;
type ClusterRecord = typeof keywordMagicClusters.$inferSelect;

export type KeywordMagicInsertKeyword = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  wordCount: number;
  isBroad: boolean;
  isPhrase: boolean;
  isExact: boolean;
  isQuestion: boolean;
  source: "related" | "suggestions" | "ideas" | "google_ads";
  metricsUpdatedAt: string | null;
  serpFeatures: string[];
  clusterName: string;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function findRunByFingerprint(params: {
  projectId: string;
  fingerprint: string;
}): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(keywordMagicRuns)
    .where(
      and(
        eq(keywordMagicRuns.projectId, params.projectId),
        eq(keywordMagicRuns.fingerprint, params.fingerprint),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findReadyRun(params: {
  projectId: string;
  fingerprint: string;
}): Promise<RunRecord | null> {
  return findRunByFingerprint(params);
}

async function getRunById(params: {
  projectId: string;
  runId: string;
}): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(keywordMagicRuns)
    .where(
      and(
        eq(keywordMagicRuns.id, params.runId),
        eq(keywordMagicRuns.projectId, params.projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listHistory(params: {
  projectId: string;
  limit?: number;
}): Promise<RunRecord[]> {
  return db
    .select()
    .from(keywordMagicRuns)
    .where(
      and(
        eq(keywordMagicRuns.projectId, params.projectId),
        eq(keywordMagicRuns.status, "ready"),
      ),
    )
    .orderBy(desc(keywordMagicRuns.createdAt))
    .limit(params.limit ?? 20);
}

async function insertRun(params: {
  id: string;
  projectId: string;
  seed: string;
  locationCode: number;
  languageCode: string;
  clickstream: boolean;
  maxKeywords: number;
  fingerprint: string;
  provider: "labs" | "google_ads";
  keywordCount: number;
  estimatedCostCredits: number;
  expiresAt: string;
}): Promise<void> {
  await db
    .insert(keywordMagicRuns)
    .values({
      id: params.id,
      projectId: params.projectId,
      seed: params.seed,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      clickstream: params.clickstream,
      maxKeywords: params.maxKeywords,
      fingerprint: params.fingerprint,
      status: "ready",
      provider: params.provider,
      keywordCount: params.keywordCount,
      estimatedCostCredits: params.estimatedCostCredits,
      expiresAt: params.expiresAt,
    })
    .onConflictDoUpdate({
      target: [keywordMagicRuns.projectId, keywordMagicRuns.fingerprint],
      set: {
        id: params.id,
        seed: params.seed,
        locationCode: params.locationCode,
        languageCode: params.languageCode,
        clickstream: params.clickstream,
        maxKeywords: params.maxKeywords,
        status: "ready",
        provider: params.provider,
        keywordCount: params.keywordCount,
        estimatedCostCredits: params.estimatedCostCredits,
        expiresAt: params.expiresAt,
      },
    });
}

async function replaceRunContents(params: {
  runId: string;
  clusters: {
    id: string;
    name: string;
    keywordCount: number;
    sortOrder: number;
  }[];
  keywords: (KeywordMagicInsertKeyword & {
    id: string;
    clusterId: string | null;
  })[];
}): Promise<void> {
  await db
    .delete(keywordMagicKeywords)
    .where(eq(keywordMagicKeywords.runId, params.runId));
  await db
    .delete(keywordMagicClusters)
    .where(eq(keywordMagicClusters.runId, params.runId));

  if (params.clusters.length > 0) {
    await executeInBatches(params.clusters, (tx, cluster) =>
      tx.insert(keywordMagicClusters).values({
        id: cluster.id,
        runId: params.runId,
        name: cluster.name,
        keywordCount: cluster.keywordCount,
        sortOrder: cluster.sortOrder,
      }),
    );
  }

  if (params.keywords.length > 0) {
    await executeInBatches(params.keywords, (tx, row) =>
      tx.insert(keywordMagicKeywords).values({
        id: row.id,
        runId: params.runId,
        clusterId: row.clusterId,
        keyword: row.keyword,
        searchVolume: row.searchVolume,
        cpc: row.cpc,
        competition: row.competition,
        keywordDifficulty: row.keywordDifficulty,
        intent: row.intent,
        wordCount: row.wordCount,
        isBroad: row.isBroad,
        isPhrase: row.isPhrase,
        isExact: row.isExact,
        isQuestion: row.isQuestion,
        source: row.source,
        metricsUpdatedAt: row.metricsUpdatedAt,
      }),
    );

    const features = params.keywords.flatMap((row) =>
      row.serpFeatures.map((feature) => ({
        keywordId: row.id,
        feature,
      })),
    );
    if (features.length > 0) {
      await executeInBatches(features, (tx, feature) =>
        tx.insert(keywordMagicSerpFeatures).values(feature),
      );
    }
  }
}

function matchTypeClause(matchType: KeywordMagicMatchType | undefined): SQL[] {
  if (matchType == null || matchType === "all") return [];
  if (matchType === "broad") return [eq(keywordMagicKeywords.isBroad, true)];
  if (matchType === "phrase") return [eq(keywordMagicKeywords.isPhrase, true)];
  if (matchType === "exact") return [eq(keywordMagicKeywords.isExact, true)];
  if (matchType === "questions")
    return [eq(keywordMagicKeywords.isQuestion, true)];
  return [eq(keywordMagicKeywords.isBroad, false)];
}

function buildKeywordWhere(
  runId: string,
  filters: KeywordMagicFilters,
): SQL | undefined {
  const clauses: SQL[] = [eq(keywordMagicKeywords.runId, runId)];
  clauses.push(...matchTypeClause(filters.matchType));
  if (filters.clusterId) {
    clauses.push(eq(keywordMagicKeywords.clusterId, filters.clusterId));
  }
  for (const term of filters.includeTerms ?? []) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    clauses.push(
      sql`lower(${keywordMagicKeywords.keyword}) like ${`%${escapeLike(trimmed.toLocaleLowerCase())}%`} escape '\\'`,
    );
  }
  for (const term of filters.excludeTerms ?? []) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    clauses.push(
      sql`lower(${keywordMagicKeywords.keyword}) not like ${`%${escapeLike(trimmed.toLocaleLowerCase())}%`} escape '\\'`,
    );
  }
  if (filters.minVolume != null) {
    clauses.push(gte(keywordMagicKeywords.searchVolume, filters.minVolume));
  }
  if (filters.maxVolume != null) {
    clauses.push(lte(keywordMagicKeywords.searchVolume, filters.maxVolume));
  }
  if (filters.minCpc != null) {
    clauses.push(gte(keywordMagicKeywords.cpc, filters.minCpc));
  }
  if (filters.maxCpc != null) {
    clauses.push(lte(keywordMagicKeywords.cpc, filters.maxCpc));
  }
  if (filters.minDifficulty != null) {
    clauses.push(
      gte(keywordMagicKeywords.keywordDifficulty, filters.minDifficulty),
    );
  }
  if (filters.maxDifficulty != null) {
    clauses.push(
      lte(keywordMagicKeywords.keywordDifficulty, filters.maxDifficulty),
    );
  }
  if (filters.minWordCount != null) {
    clauses.push(gte(keywordMagicKeywords.wordCount, filters.minWordCount));
  }
  if (filters.maxWordCount != null) {
    clauses.push(lte(keywordMagicKeywords.wordCount, filters.maxWordCount));
  }
  if (filters.intents && filters.intents.length > 0) {
    clauses.push(inArray(keywordMagicKeywords.intent, filters.intents));
  }
  if (filters.serpFeatures && filters.serpFeatures.length > 0) {
    clauses.push(
      sql`exists (
        select 1
        from ${keywordMagicSerpFeatures}
        where ${keywordMagicSerpFeatures.keywordId} = ${keywordMagicKeywords.id}
        and ${inArray(keywordMagicSerpFeatures.feature, filters.serpFeatures)}
      )`,
    );
  }
  return and(...clauses);
}

function buildOrderBy(
  sort: KeywordMagicSortField = "searchVolume",
  order: "asc" | "desc" = "desc",
) {
  const direction = order === "asc" ? asc : desc;
  switch (sort) {
    case "keyword":
      return direction(keywordMagicKeywords.keyword);
    case "cpc":
      return direction(keywordMagicKeywords.cpc);
    case "competition":
      return direction(keywordMagicKeywords.competition);
    case "keywordDifficulty":
      return direction(keywordMagicKeywords.keywordDifficulty);
    case "wordCount":
      return direction(keywordMagicKeywords.wordCount);
    case "metricsUpdatedAt":
      return direction(keywordMagicKeywords.metricsUpdatedAt);
    case "searchVolume":
    default:
      return direction(keywordMagicKeywords.searchVolume);
  }
}

async function listKeywordsPage(params: {
  runId: string;
  filters: KeywordMagicFilters;
  page: number;
  pageSize: number;
  sort?: KeywordMagicSortField;
  order?: "asc" | "desc";
}): Promise<{
  rows: { keyword: KeywordRecord; clusterName: string | null }[];
  totalCount: number;
  hasMore: boolean;
}> {
  const where = buildKeywordWhere(params.runId, params.filters);
  const offset = (params.page - 1) * params.pageSize;

  const [{ value: totalCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(keywordMagicKeywords)
    .where(where);

  const rows = await db
    .select({
      keyword: keywordMagicKeywords,
      clusterName: keywordMagicClusters.name,
    })
    .from(keywordMagicKeywords)
    .leftJoin(
      keywordMagicClusters,
      eq(keywordMagicClusters.id, keywordMagicKeywords.clusterId),
    )
    .where(where)
    .orderBy(
      buildOrderBy(params.sort, params.order),
      asc(keywordMagicKeywords.id),
    )
    .limit(params.pageSize)
    .offset(offset);

  return {
    rows,
    totalCount,
    hasMore: computeHasMore(offset, rows.length, totalCount, params.pageSize),
  };
}

async function listKeywordsForExport(params: {
  runId: string;
  filters: KeywordMagicFilters;
  sort?: KeywordMagicSortField;
  order?: "asc" | "desc";
}): Promise<{ keyword: KeywordRecord; clusterName: string | null }[]> {
  return db
    .select({
      keyword: keywordMagicKeywords,
      clusterName: keywordMagicClusters.name,
    })
    .from(keywordMagicKeywords)
    .leftJoin(
      keywordMagicClusters,
      eq(keywordMagicClusters.id, keywordMagicKeywords.clusterId),
    )
    .where(buildKeywordWhere(params.runId, params.filters))
    .orderBy(
      buildOrderBy(params.sort, params.order),
      asc(keywordMagicKeywords.id),
    );
}

async function listClusters(runId: string): Promise<ClusterRecord[]> {
  return db
    .select()
    .from(keywordMagicClusters)
    .where(eq(keywordMagicClusters.runId, runId))
    .orderBy(asc(keywordMagicClusters.sortOrder));
}

async function listSerpFeaturesByKeywordIds(
  keywordIds: string[],
): Promise<Map<string, string[]>> {
  const features = new Map<string, string[]>();
  if (keywordIds.length === 0) return features;
  const rows = await db
    .select()
    .from(keywordMagicSerpFeatures)
    .where(inArray(keywordMagicSerpFeatures.keywordId, keywordIds));
  for (const row of rows) {
    const list = features.get(row.keywordId) ?? [];
    list.push(row.feature);
    features.set(row.keywordId, list);
  }
  return features;
}

async function listKeywordsByValues(params: {
  runId: string;
  keywords: string[];
}): Promise<KeywordRecord[]> {
  if (params.keywords.length === 0) return [];
  const rows: KeywordRecord[] = [];
  for (let index = 0; index < params.keywords.length; index += 80) {
    const chunk = params.keywords.slice(index, index + 80);
    rows.push(
      ...(await db
        .select()
        .from(keywordMagicKeywords)
        .where(
          and(
            eq(keywordMagicKeywords.runId, params.runId),
            inArray(keywordMagicKeywords.keyword, chunk),
          ),
        )),
    );
  }
  return rows;
}

async function updateKeywordMetrics(
  updates: {
    id: string;
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    keywordDifficulty: number | null;
    intent: string | null;
    metricsUpdatedAt: string;
  }[],
): Promise<void> {
  await executeInBatches(updates, (tx, update) =>
    tx
      .update(keywordMagicKeywords)
      .set({
        searchVolume: update.searchVolume,
        cpc: update.cpc,
        competition: update.competition,
        keywordDifficulty: update.keywordDifficulty,
        intent: update.intent,
        metricsUpdatedAt: update.metricsUpdatedAt,
      })
      .where(eq(keywordMagicKeywords.id, update.id)),
  );
}

export const KeywordMagicRepository = {
  findReadyRun,
  getRunById,
  listHistory,
  insertRun,
  replaceRunContents,
  listKeywordsPage,
  listKeywordsForExport,
  listClusters,
  listSerpFeaturesByKeywordIds,
  listKeywordsByValues,
  updateKeywordMetrics,
} as const;
