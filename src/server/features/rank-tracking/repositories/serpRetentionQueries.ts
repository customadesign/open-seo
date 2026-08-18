import { and, desc, eq, exists } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns, rankSerpEntries } from "@/db/schema";
import { runBatch } from "@/db/runBatch";

/**
 * Completed checks for a config that still have rank_serp_entries.
 * EXISTS on run_id uses the existing (run_id, …) unique index — no table scan.
 */
export async function listRetainedSerpRunsForConfig(configId: string) {
  const hasEntries = db
    .select({ runId: rankSerpEntries.runId })
    .from(rankSerpEntries)
    .where(eq(rankSerpEntries.runId, rankCheckRuns.id));

  return db
    .select({
      id: rankCheckRuns.id,
      startedAt: rankCheckRuns.startedAt,
    })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
        exists(hasEntries),
      ),
    )
    .orderBy(desc(rankCheckRuns.startedAt));
}

/**
 * Delete SERP detail for one check. Does not touch rank_snapshots or the run
 * row beyond the pruned flag — ranking history stays complete.
 */
export async function pruneSerpEntriesForRun(runId: string) {
  await runBatch((tx) => [
    tx.delete(rankSerpEntries).where(eq(rankSerpEntries.runId, runId)),
    tx
      .update(rankCheckRuns)
      .set({ serpPruned: true })
      .where(eq(rankCheckRuns.id, runId)),
  ]);
}
