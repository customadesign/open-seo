import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns } from "@/db/schema";

async function getPreviousCompletedFullRun(
  configId: string,
  beforeStartedAt: string,
) {
  const rows = await db
    .select()
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        eq(rankCheckRuns.isSubsetRun, false),
        lt(rankCheckRuns.startedAt, beforeStartedAt),
      ),
    )
    .orderBy(desc(rankCheckRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export const RankChangeRepository = {
  getPreviousCompletedFullRun,
} as const;
