import {
  listRetainedSerpRunsForConfig,
  pruneSerpEntriesForRun,
} from "@/server/features/rank-tracking/repositories/serpRetentionQueries";
import { selectSerpRunsToPrune } from "@/shared/rank-serp-retention";

/**
 * Drop SERP detail for captured checks outside the retention window.
 * Called from rank-check finalize so it rides the existing check path.
 * Ranking snapshots and run rows are never deleted.
 */
export async function pruneExpiredSerpEntries(
  configId: string,
  now = new Date(),
) {
  const retained = await listRetainedSerpRunsForConfig(configId);
  const runIds = selectSerpRunsToPrune(retained, now);
  for (const runId of runIds) {
    await pruneSerpEntriesForRun(runId);
  }
  return { prunedRunCount: runIds.length };
}
