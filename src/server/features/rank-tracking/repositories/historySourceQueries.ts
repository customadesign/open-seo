import { and, asc, count, countDistinct, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns, rankHistorySources, rankSnapshots } from "@/db/schema";

/** Imported source metadata and reconciliation counts for a config. */
export async function getHistorySourceSummaries(configId: string) {
  return db
    .select({
      id: rankHistorySources.id,
      provider: rankHistorySources.provider,
      externalCampaignId: rankHistorySources.externalCampaignId,
      searchEngine: rankHistorySources.searchEngine,
      sourceLocationName: rankHistorySources.sourceLocationName,
      sourceLocationType: rankHistorySources.sourceLocationType,
      languageCode: rankHistorySources.languageCode,
      device: rankHistorySources.device,
      continuity: rankHistorySources.continuity,
      firstObservedAt: rankHistorySources.firstObservedAt,
      lastObservedAt: rankHistorySources.lastObservedAt,
      importedAt: rankHistorySources.importedAt,
      runCount: countDistinct(rankCheckRuns.id),
      snapshotCount: count(rankSnapshots.id),
    })
    .from(rankHistorySources)
    .leftJoin(
      rankCheckRuns,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .leftJoin(rankSnapshots, eq(rankSnapshots.runId, rankCheckRuns.id))
    .where(eq(rankHistorySources.configId, configId))
    .groupBy(
      rankHistorySources.id,
      rankHistorySources.provider,
      rankHistorySources.externalCampaignId,
      rankHistorySources.searchEngine,
      rankHistorySources.sourceLocationName,
      rankHistorySources.sourceLocationType,
      rankHistorySources.languageCode,
      rankHistorySources.device,
      rankHistorySources.continuity,
      rankHistorySources.firstObservedAt,
      rankHistorySources.lastObservedAt,
      rankHistorySources.importedAt,
    )
    .orderBy(asc(rankHistorySources.firstObservedAt));
}

/** First-to-last movement inside one imported campaign. */
export async function getHistorySourceMovement(
  configId: string,
  sourceId: string,
) {
  const runs = await db
    .select({ id: rankCheckRuns.id, startedAt: rankCheckRuns.startedAt })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.historySourceId, sourceId),
        eq(rankCheckRuns.status, "completed"),
      ),
    )
    .orderBy(asc(rankCheckRuns.startedAt));
  const firstRun = runs[0];
  const lastRun = runs.at(-1);
  if (!firstRun || !lastRun) return [];

  const rows = await db
    .select({
      runId: rankSnapshots.runId,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      keyword: rankSnapshots.keyword,
      device: rankSnapshots.device,
      position: rankSnapshots.position,
    })
    .from(rankSnapshots)
    .where(inArray(rankSnapshots.runId, [firstRun.id, lastRun.id]));
  const byKeyword = new Map<
    string,
    {
      trackingKeywordId: string;
      keyword: string;
      device: "desktop" | "mobile";
      firstPosition: number | null;
      lastPosition: number | null;
    }
  >();
  for (const row of rows) {
    const key = `${row.trackingKeywordId}:${row.device}`;
    const current = byKeyword.get(key) ?? {
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      device: row.device,
      firstPosition: null,
      lastPosition: null,
    };
    if (row.runId === firstRun.id) current.firstPosition = row.position;
    if (row.runId === lastRun.id) current.lastPosition = row.position;
    byKeyword.set(key, current);
  }
  return [...byKeyword.values()].map((row) => ({
    ...row,
    change:
      row.firstPosition != null && row.lastPosition != null
        ? row.firstPosition - row.lastPosition
        : null,
    firstCheckedAt: firstRun.startedAt,
    lastCheckedAt: lastRun.startedAt,
  }));
}
