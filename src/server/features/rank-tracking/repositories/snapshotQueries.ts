import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  rankCheckRuns,
  rankHistorySources,
  rankSerpEntries,
  rankSnapshots,
  rankTrackingConfigs,
} from "@/db/schema";
import { DB_BATCH_SIZE } from "@/db/runBatch";
import { toSqliteTimestamp } from "@/server/features/rank-tracking/rankTrackingTimestamps";

function sameTargetAsCurrentConfig() {
  return and(
    eq(rankCheckRuns.targetLocationCode, rankTrackingConfigs.locationCode),
    eq(rankCheckRuns.targetLanguageCode, rankTrackingConfigs.languageCode),
    or(
      and(
        isNull(rankCheckRuns.targetLocationName),
        isNull(rankTrackingConfigs.locationName),
      ),
      eq(rankCheckRuns.targetLocationName, rankTrackingConfigs.locationName),
    ),
  );
}

function completedRunIdsForConfig(configId: string) {
  return db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        sameTargetAsCurrentConfig(),
        or(
          isNull(rankCheckRuns.historySourceId),
          eq(rankHistorySources.continuity, "continuous"),
        ),
      ),
    );
}

function cutoffTimestamp(sinceDays: number): string {
  return toSqliteTimestamp(
    new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000),
  );
}

/**
 * Flat per-keyword position series across completed runs, ordered oldest first.
 * `null` position = checked but not found within serpDepth (a real event, not a
 * missing check). The client pivots these rows per device.
 */
export async function getKeywordHistory(
  configId: string,
  trackingKeywordId: string,
  sinceDays?: number,
) {
  const conditions = [
    inArray(rankSnapshots.runId, completedRunIdsForConfig(configId)),
    eq(rankSnapshots.trackingKeywordId, trackingKeywordId),
  ];
  if (sinceDays != null) {
    conditions.push(gte(rankSnapshots.checkedAt, cutoffTimestamp(sinceDays)));
  }
  return db
    .select({
      device: rankSnapshots.device,
      checkedAt: rankSnapshots.checkedAt,
      position: rankSnapshots.position,
      serpDepth: rankCheckRuns.targetSerpDepth,
      sourceProvider: rankHistorySources.provider,
      sourceEngine: rankHistorySources.searchEngine,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(and(...conditions))
    .orderBy(asc(rankSnapshots.checkedAt));
}

/**
 * Per-run keyword-position distribution for one device, oldest first. Grouped
 * by runId (not checkedAt — snapshots in a run don't share an exact insert
 * time); the run's startedAt is the x-axis timestamp. The buckets are disjoint
 * and cover every tracked keyword: a position past 20, or null (not found in
 * the tracked depth), falls into "not ranking" (derived from `total`).
 */
export async function getConfigTrend(
  configId: string,
  device: "desktop" | "mobile",
  sinceDays?: number,
) {
  const conditions = [
    eq(rankCheckRuns.configId, configId),
    eq(rankCheckRuns.status, "completed"),
    eq(rankCheckRuns.isSubsetRun, false),
    eq(rankSnapshots.device, device),
    or(
      isNull(rankCheckRuns.historySourceId),
      eq(rankHistorySources.continuity, "continuous"),
    ),
    sameTargetAsCurrentConfig(),
  ];
  if (sinceDays != null) {
    conditions.push(gte(rankSnapshots.checkedAt, cutoffTimestamp(sinceDays)));
  }
  return db
    .select({
      runId: rankSnapshots.runId,
      checkedAt: rankCheckRuns.startedAt,
      sourceProvider: rankHistorySources.provider,
      total: count(),
      top3: sql<number>`sum(case when ${rankSnapshots.position} between 1 and 3 then 1 else 0 end)`,
      top4to10: sql<number>`sum(case when ${rankSnapshots.position} between 4 and 10 then 1 else 0 end)`,
      top11to20: sql<number>`sum(case when ${rankSnapshots.position} between 11 and 20 then 1 else 0 end)`,
      top21to100: sql<number>`sum(case when ${rankSnapshots.position} between 21 and 100 then 1 else 0 end)`,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(and(...conditions))
    .groupBy(
      rankSnapshots.runId,
      rankCheckRuns.startedAt,
      rankHistorySources.provider,
    )
    .orderBy(asc(rankCheckRuns.startedAt));
}

/**
 * Recent per-keyword positions for one device as a flat list, for the "by date"
 * history matrix. Bounded to the last `runLimit` completed runs; the client
 * pivots these into keyword rows × run (date) columns.
 */
export async function getPositionMatrix(
  configId: string,
  device: "desktop" | "mobile",
  runLimit: number,
) {
  const recentRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .innerJoin(
      rankTrackingConfigs,
      eq(rankCheckRuns.configId, rankTrackingConfigs.id),
    )
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
        sameTargetAsCurrentConfig(),
        or(
          isNull(rankCheckRuns.historySourceId),
          eq(rankHistorySources.continuity, "continuous"),
        ),
      ),
    )
    .orderBy(desc(rankCheckRuns.startedAt))
    .limit(runLimit);

  return db
    .select({
      runId: rankSnapshots.runId,
      checkedAt: rankCheckRuns.startedAt,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      position: rankSnapshots.position,
      sourceProvider: rankHistorySources.provider,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(
      and(
        inArray(rankSnapshots.runId, recentRunIds),
        eq(rankSnapshots.device, device),
      ),
    )
    .orderBy(asc(rankCheckRuns.startedAt));
}

/**
 * Pick one snapshot per keyword+device from completed runs, using SQL GROUP BY
 * + self-join instead of loading all snapshots into JS memory.
 *
 * No keywordIds needed — scoped to the config via a completed-runs subquery,
 * so subset runs are included automatically.
 */
export async function getSnapshotsForConfig(
  configId: string,
  opts: { beforeDate?: string; order: "latest" | "earliest" },
) {
  const completedRunIds = completedRunIdsForConfig(configId);

  const aggFn = opts.order === "latest" ? max : min;

  const conditions = [inArray(rankSnapshots.runId, completedRunIds)];
  if (opts.beforeDate) {
    conditions.push(lte(rankSnapshots.checkedAt, opts.beforeDate));
  }

  const grouped = db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      device: rankSnapshots.device,
      targetCheckedAt: aggFn(rankSnapshots.checkedAt).as("target_checked_at"),
    })
    .from(rankSnapshots)
    .where(and(...conditions))
    .groupBy(rankSnapshots.trackingKeywordId, rankSnapshots.device)
    .as("grouped");

  return db
    .select({
      id: rankSnapshots.id,
      runId: rankSnapshots.runId,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      keyword: rankSnapshots.keyword,
      device: rankSnapshots.device,
      position: rankSnapshots.position,
      url: rankSnapshots.url,
      serpFeatures: rankSnapshots.serpFeatures,
      serpCaptured: rankSnapshots.serpCaptured,
      checkedAt: rankSnapshots.checkedAt,
      sourceProvider: rankHistorySources.provider,
    })
    .from(rankSnapshots)
    .innerJoin(
      grouped,
      and(
        eq(rankSnapshots.trackingKeywordId, grouped.trackingKeywordId),
        eq(rankSnapshots.device, grouped.device),
        eq(rankSnapshots.checkedAt, grouped.targetCheckedAt),
      ),
    )
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .leftJoin(
      rankHistorySources,
      eq(rankCheckRuns.historySourceId, rankHistorySources.id),
    )
    .where(inArray(rankSnapshots.runId, completedRunIds));
}

const REPORT_RUN_LIMIT = 52;

export async function getSerpEntriesForRuns(
  runIds: string[],
  filters?: {
    rowKind?: (typeof rankSerpEntries.rowKind.enumValues)[number];
    device?: "desktop" | "mobile";
  },
) {
  if (runIds.length === 0) return [];
  const rows: Array<typeof rankSerpEntries.$inferSelect> = [];
  for (let i = 0; i < runIds.length; i += DB_BATCH_SIZE) {
    const chunk = runIds.slice(i, i + DB_BATCH_SIZE);
    const conditions = [inArray(rankSerpEntries.runId, chunk)];
    if (filters?.rowKind) {
      conditions.push(eq(rankSerpEntries.rowKind, filters.rowKind));
    }
    if (filters?.device) {
      conditions.push(eq(rankSerpEntries.device, filters.device));
    }
    rows.push(
      ...(await db
        .select()
        .from(rankSerpEntries)
        .where(and(...conditions))),
    );
  }
  return rows;
}

/**
 * Newest completed full-config runs (subset/add-keyword checks are excluded so
 * band counts and URL history stay comparable across the keyword set).
 */
export async function getCompletedFullRuns(
  configId: string,
  limit = REPORT_RUN_LIMIT,
) {
  return db
    .select({
      id: rankCheckRuns.id,
      startedAt: rankCheckRuns.startedAt,
      serpPruned: rankCheckRuns.serpPruned,
    })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
      ),
    )
    .orderBy(desc(rankCheckRuns.startedAt))
    .limit(limit);
}

/**
 * Flat snapshot rows for a set of completed runs. Bounded by the caller so the
 * IN list stays well under D1's parameter cap.
 */
export async function getSnapshotsForRuns(runIds: string[]) {
  if (runIds.length === 0) return [];

  return db
    .select({
      runId: rankSnapshots.runId,
      checkedAt: rankCheckRuns.startedAt,
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      keyword: rankSnapshots.keyword,
      device: rankSnapshots.device,
      position: rankSnapshots.position,
      url: rankSnapshots.url,
      serpFeatures: rankSnapshots.serpFeatures,
      serpCaptured: rankSnapshots.serpCaptured,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
    .where(inArray(rankSnapshots.runId, runIds))
    .orderBy(asc(rankCheckRuns.startedAt));
}

export async function getLatestSnapshotsForKeywords(configId: string) {
  return getSnapshotsForConfig(configId, { order: "latest" });
}

export async function getSnapshotsBeforeDate(
  configId: string,
  beforeDate: string,
) {
  return getSnapshotsForConfig(configId, { beforeDate, order: "latest" });
}

export async function getEarliestSnapshotsForKeywords(
  configId: string,
  keywordIds: string[],
) {
  if (keywordIds.length === 0) return [];

  const completedRunIds = completedRunIdsForConfig(configId);

  // D1 caps bound parameters at 100 per statement. The query binds N keyword
  // IDs plus 4 params from the completedRunIds subquery (referenced twice).
  // (Postgres allows far more, but the chunking is harmless there.)
  const CHUNK_SIZE = 90;
  const allResults: Awaited<ReturnType<typeof getSnapshotsForConfig>> = [];

  for (let i = 0; i < keywordIds.length; i += CHUNK_SIZE) {
    const chunk = keywordIds.slice(i, i + CHUNK_SIZE);

    const grouped = db
      .select({
        trackingKeywordId: rankSnapshots.trackingKeywordId,
        device: rankSnapshots.device,
        targetCheckedAt: min(rankSnapshots.checkedAt).as("target_checked_at"),
      })
      .from(rankSnapshots)
      .where(
        and(
          inArray(rankSnapshots.runId, completedRunIds),
          inArray(rankSnapshots.trackingKeywordId, chunk),
        ),
      )
      .groupBy(rankSnapshots.trackingKeywordId, rankSnapshots.device)
      .as("grouped");

    const rows = await db
      .select({
        id: rankSnapshots.id,
        runId: rankSnapshots.runId,
        trackingKeywordId: rankSnapshots.trackingKeywordId,
        keyword: rankSnapshots.keyword,
        device: rankSnapshots.device,
        position: rankSnapshots.position,
        url: rankSnapshots.url,
        serpFeatures: rankSnapshots.serpFeatures,
        serpCaptured: rankSnapshots.serpCaptured,
        checkedAt: rankSnapshots.checkedAt,
        sourceProvider: rankHistorySources.provider,
      })
      .from(rankSnapshots)
      .innerJoin(
        grouped,
        and(
          eq(rankSnapshots.trackingKeywordId, grouped.trackingKeywordId),
          eq(rankSnapshots.device, grouped.device),
          eq(rankSnapshots.checkedAt, grouped.targetCheckedAt),
        ),
      )
      .innerJoin(rankCheckRuns, eq(rankSnapshots.runId, rankCheckRuns.id))
      .leftJoin(
        rankHistorySources,
        eq(rankCheckRuns.historySourceId, rankHistorySources.id),
      )
      .where(inArray(rankSnapshots.runId, completedRunIds));

    allResults.push(...rows);
  }

  return allResults;
}

export {
  getHistorySourceMovement,
  getHistorySourceSummaries,
} from "./historySourceQueries";
