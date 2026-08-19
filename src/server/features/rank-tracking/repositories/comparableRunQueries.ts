import { and, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns, rankHistorySources } from "@/db/schema";

function runTargetMatchesCurrentConfig() {
  return sql<boolean>`exists (
    select 1 from rank_tracking_configs current_config
    where current_config.id = ${rankCheckRuns.configId}
      and current_config.location_code = ${rankCheckRuns.targetLocationCode}
      and current_config.language_code = ${rankCheckRuns.targetLanguageCode}
      and (
        (current_config.location_name is null and ${rankCheckRuns.targetLocationName} is null)
        or current_config.location_name = ${rankCheckRuns.targetLocationName}
      )
  )`;
}

function continuousSourceIds() {
  return db
    .select({ id: rankHistorySources.id })
    .from(rankHistorySources)
    .where(eq(rankHistorySources.continuity, "continuous"));
}

function comparableRunCondition() {
  return and(
    runTargetMatchesCurrentConfig(),
    or(
      isNull(rankCheckRuns.historySourceId),
      inArray(rankCheckRuns.historySourceId, continuousSourceIds()),
    ),
  );
}

export async function getLatestComparableRunForConfig(configId: string) {
  const rows = await db
    .select()
    .from(rankCheckRuns)
    .where(and(eq(rankCheckRuns.configId, configId), comparableRunCondition()))
    .orderBy(desc(rankCheckRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

type LatestRunSummary = {
  status: "pending" | "running" | "completed" | "failed";
  completedAt: string | null;
};

export async function getLatestComparableRunSummaries(
  configIds: string[],
): Promise<Map<string, LatestRunSummary>> {
  if (configIds.length === 0) return new Map<string, LatestRunSummary>();
  const latestStarted = db
    .select({
      configId: rankCheckRuns.configId,
      maxStartedAt: max(rankCheckRuns.startedAt).as("maxStartedAt"),
    })
    .from(rankCheckRuns)
    .where(
      and(inArray(rankCheckRuns.configId, configIds), comparableRunCondition()),
    )
    .groupBy(rankCheckRuns.configId)
    .as("latestStarted");
  const latestRuns = await db
    .select({
      configId: rankCheckRuns.configId,
      status: rankCheckRuns.status,
      completedAt: rankCheckRuns.completedAt,
    })
    .from(rankCheckRuns)
    .innerJoin(
      latestStarted,
      and(
        eq(rankCheckRuns.configId, latestStarted.configId),
        eq(rankCheckRuns.startedAt, latestStarted.maxStartedAt),
      ),
    );
  return new Map(
    latestRuns.map((run) => [
      run.configId,
      { status: run.status, completedAt: run.completedAt },
    ]),
  );
}
