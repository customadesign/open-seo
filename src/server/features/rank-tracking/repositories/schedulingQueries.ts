import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, rankTrackingConfigs } from "@/db/schema";
import type { RankTrackingSkipReason } from "@/shared/rank-tracking";

// Cron-side queries for rank tracking: which configs are due, and the
// compare-and-set that claims one. Split from RankTrackingRepository so the
// scheduler's query surface stays readable on its own.

// Caps per-tick loop work (claims, per-org plan checks) against the cron
// wall clock; paid-heavy ticks are stopped earlier by the unit budget and
// slow ticks by TICK_DEADLINE_MS in scheduledRankChecks.ts.
const DUE_CONFIGS_PER_TICK = 500;

export async function getDueConfigsWithOrganization(nowIso: string) {
  return (
    db
      .select({
        id: rankTrackingConfigs.id,
        projectId: rankTrackingConfigs.projectId,
        domain: rankTrackingConfigs.domain,
        engine: rankTrackingConfigs.engine,
        locationCode: rankTrackingConfigs.locationCode,
        languageCode: rankTrackingConfigs.languageCode,
        locationName: rankTrackingConfigs.locationName,
        devices: rankTrackingConfigs.devices,
        serpDepth: rankTrackingConfigs.serpDepth,
        scheduleInterval: rankTrackingConfigs.scheduleInterval,
        maxCostCredits: rankTrackingConfigs.maxCostCredits,
        nextCheckAt: rankTrackingConfigs.nextCheckAt,
        organizationId: projects.organizationId,
      })
      .from(rankTrackingConfigs)
      .innerJoin(projects, eq(rankTrackingConfigs.projectId, projects.id))
      .where(
        and(
          eq(rankTrackingConfigs.isActive, true),
          // A manual config can keep a stale non-null next_check_at; without this
          // it would be selected every tick and never advanced.
          ne(rankTrackingConfigs.scheduleInterval, "manual"),
          lte(rankTrackingConfigs.nextCheckAt, nowIso),
          isNull(projects.archivedAt),
        ),
      )
      // Oldest first so a large backlog drains in order instead of the same
      // arbitrary rows filling every batch. `lte` already excludes NULL, so both
      // ordering columns are non-null and SQLite/Postgres agree.
      .orderBy(
        asc(rankTrackingConfigs.nextCheckAt),
        asc(rankTrackingConfigs.id),
      )
      .limit(DUE_CONFIGS_PER_TICK)
  );
}

/**
 * Conditionally advance a due config's schedule, returning false when the
 * config changed underneath us (manual edit, deactivation).
 *
 * `next_check_at` equality is the compare-and-set token. `schedule_interval` is
 * deliberately absent from the predicate: every schedule edit rewrites
 * `next_check_at` (updateConfig recomputes it, or nulls it for "manual"), so
 * the timestamp check already detects interval changes.
 *
 * `lastSkipReason` is written only when the caller passes it — the restore
 * path omits it so it can't clobber a reason the blocking run just wrote.
 */
export async function claimDueConfig(input: {
  configId: string;
  projectId: string;
  observedNextCheckAt: string;
  nextCheckAt: string;
  lastSkipReason?: RankTrackingSkipReason | null;
}): Promise<boolean> {
  const claimed = await db
    .update(rankTrackingConfigs)
    .set({
      nextCheckAt: input.nextCheckAt,
      ...(input.lastSkipReason !== undefined && {
        lastSkipReason: input.lastSkipReason,
      }),
    })
    .where(
      and(
        eq(rankTrackingConfigs.id, input.configId),
        eq(rankTrackingConfigs.projectId, input.projectId),
        eq(rankTrackingConfigs.isActive, true),
        eq(rankTrackingConfigs.nextCheckAt, input.observedNextCheckAt),
      ),
    )
    .returning({ id: rankTrackingConfigs.id });
  return claimed.length > 0;
}
