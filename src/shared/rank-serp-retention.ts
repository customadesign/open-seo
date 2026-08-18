/** Most recent captured checks whose SERP detail is kept per tracker. */
export const RANK_SERP_RETAINED_CHECKS = 12;

/**
 * Do not prune a check younger than this, so a daily tracker still keeps a
 * couple of weeks of SERP detail even though 12 daily checks are only 12 days.
 */
export const RANK_SERP_MIN_AGE_DAYS = 14;

/** Oldest eligible runs deleted per rank-check finalize. Bounds first-run backlog. */
export const RANK_SERP_PRUNE_BATCH_SIZE = 2;

export type RetainedSerpRun = {
  id: string;
  startedAt: string;
};

/**
 * Choose captured runs whose rank_serp_entries can be deleted. Newest `retain`
 * checks and anything younger than `minAgeDays` are kept. Returns at most
 * `batchSize` of the oldest remainder — callers must delete by run id so each
 * statement uses the existing (run_id, …) index.
 */
export function selectSerpRunsToPrune(
  runsNewestFirst: readonly RetainedSerpRun[],
  now: Date,
  options?: {
    retain?: number;
    minAgeDays?: number;
    batchSize?: number;
  },
): string[] {
  const retain = options?.retain ?? RANK_SERP_RETAINED_CHECKS;
  const minAgeDays = options?.minAgeDays ?? RANK_SERP_MIN_AGE_DAYS;
  const batchSize = options?.batchSize ?? RANK_SERP_PRUNE_BATCH_SIZE;
  const cutoff = new Date(
    now.getTime() - minAgeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const keep = new Set<string>();
  for (const [index, run] of runsNewestFirst.entries()) {
    if (index < retain || run.startedAt > cutoff) keep.add(run.id);
  }

  return runsNewestFirst
    .filter((run) => !keep.has(run.id))
    .toReversed()
    .slice(0, batchSize)
    .map((run) => run.id);
}

export type SerpDetailStatus = "none" | "retained" | "pruned";

export function serpDetailStatus(input: {
  capturedRunCount: number;
  retainedRunCount: number;
}): SerpDetailStatus {
  if (input.retainedRunCount > 0) return "retained";
  if (input.capturedRunCount > 0) return "pruned";
  return "none";
}
