import { describe, expect, it } from "vitest";
import {
  RANK_SERP_MIN_AGE_DAYS,
  RANK_SERP_PRUNE_BATCH_SIZE,
  RANK_SERP_RETAINED_CHECKS,
  selectSerpRunsToPrune,
  serpDetailStatus,
} from "./rank-serp-retention";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function runs(
  count: number,
  startDay: number,
): Array<{
  id: string;
  startedAt: string;
}> {
  return Array.from({ length: count }, (_, index) => ({
    id: `run_${startDay + index}`,
    startedAt: daysAgo(startDay + index),
  }));
}

describe("selectSerpRunsToPrune", () => {
  it("keeps exactly N captured checks when every run is older than the age floor", () => {
    const newestFirst = runs(15, 20);
    const pruned = selectSerpRunsToPrune(newestFirst, NOW, {
      batchSize: 20,
    });
    expect(pruned).toEqual(["run_34", "run_33", "run_32"]);
    expect(
      newestFirst.slice(0, RANK_SERP_RETAINED_CHECKS).map((run) => run.id),
    ).not.toEqual(expect.arrayContaining(pruned));
  });

  it("keeps more than N daily checks that are still inside the age floor", () => {
    const newestFirst = runs(20, 0);
    const pruned = selectSerpRunsToPrune(newestFirst, NOW, { batchSize: 50 });
    const kept = newestFirst.filter((run) => !pruned.includes(run.id));
    expect(kept.length).toBeGreaterThan(RANK_SERP_RETAINED_CHECKS);
    expect(kept.length).toBe(RANK_SERP_MIN_AGE_DAYS);
    expect(pruned).toHaveLength(20 - RANK_SERP_MIN_AGE_DAYS);
  });

  it("prunes only a bounded oldest batch so first-run backlog is incremental", () => {
    const newestFirst = runs(20, 20);
    expect(selectSerpRunsToPrune(newestFirst, NOW)).toEqual([
      "run_39",
      "run_38",
    ]);
    expect(RANK_SERP_PRUNE_BATCH_SIZE).toBe(2);
  });
});

describe("serpDetailStatus", () => {
  it("distinguishes never-captured from captured-then-pruned", () => {
    expect(serpDetailStatus({ capturedRunCount: 0, retainedRunCount: 0 })).toBe(
      "none",
    );
    expect(serpDetailStatus({ capturedRunCount: 4, retainedRunCount: 0 })).toBe(
      "pruned",
    );
    expect(serpDetailStatus({ capturedRunCount: 4, retainedRunCount: 2 })).toBe(
      "retained",
    );
  });
});
