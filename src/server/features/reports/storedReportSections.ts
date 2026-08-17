/**
 * Report sections built purely from data this project already stored.
 *
 * Unlike the GSC/GA4/Ads adapters, nothing here calls a provider: a report is
 * a read of `ai_visibility_*` and `geo_grid_*` rows that an operator already
 * paid for. Generating a report therefore never bills, never starts a run and
 * never activates a paused schedule. When the stored data is missing or older
 * than the reporting period, that is reported as a fact — no value is
 * extrapolated, defaulted to zero, or otherwise invented.
 */
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiVisibilityConfigs,
  aiVisibilityObservations,
  aiVisibilityRuns,
  geoGridCells,
  geoGridConfigs,
  geoGridRuns,
  localBusinessProfiles,
} from "@/db/schema";
import type { ReportSnapshot } from "@/types/schemas/reports";

type Section = ReportSnapshot["sections"][number];

export type DateRange = {
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
};

export type SectionLoadResult =
  | { status: "loaded"; section: Section }
  | { status: "omitted"; reason: "not_configured" | "no_data" };

export function isoEndTimestamp(date: string) {
  return `${date}T23:59:59.999Z`;
}

const MS_PER_DAY = 86_400_000;

/**
 * A stored run is chosen by "newest completed on or before the period end",
 * which may well predate the period. Comparing the date prefixes (rather than
 * parsed instants) keeps this a plain calendar-day question: the run either
 * finished before the period opened or it did not.
 */
function freshness(capturedAt: string, range: DateRange) {
  const ageMs =
    new Date(isoEndTimestamp(range.periodEnd)).getTime() -
    new Date(capturedAt).getTime();
  return {
    capturedAt,
    ageDays: Math.max(0, Math.floor(ageMs / MS_PER_DAY)),
    isStale: capturedAt.slice(0, 10) < range.periodStart,
  };
}

/**
 * Newest completed run for a config at or before `cutoff`. Returns the row so
 * callers can compare identity: when the latest data is older than the
 * comparison window, the same run answers both queries and there is no trend
 * to report.
 */
async function latestCompletedRun<
  T extends typeof aiVisibilityRuns | typeof geoGridRuns,
>(table: T, configId: string, cutoff: string) {
  const rows = await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.configId, configId),
        eq(table.status, "completed"),
        isNotNull(table.completedAt),
        lte(table.completedAt, isoEndTimestamp(cutoff)),
      ),
    )
    .orderBy(desc(table.completedAt))
    .limit(1);
  return rows[0] ?? null;
}

type AiObservation = {
  provider: string;
  status: "completed" | "failed";
  outcome: "brand_mentioned" | "brand_absent" | "unavailable";
  mentionCount: number;
  domainCited: boolean | null;
};

/**
 * `status` and `outcome` are counted separately on purpose. An observation we
 * never got an answer to is `unavailable`; it is not evidence the brand was
 * absent, so it stays out of the `answerShare` denominator and is surfaced on
 * its own instead.
 */
function countObservations(observations: AiObservation[]) {
  const answered = observations.filter(
    (item) => item.status === "completed" && item.outcome !== "unavailable",
  );
  const brandMentioned = answered.filter(
    (item) => item.outcome === "brand_mentioned",
  ).length;
  return {
    answered: answered.length,
    unavailable: observations.length - answered.length,
    brandMentioned,
    brandAbsent: answered.filter((item) => item.outcome === "brand_absent")
      .length,
    mentionTotal: answered.reduce((sum, item) => sum + item.mentionCount, 0),
    domainCited: answered.filter((item) => item.domainCited === true).length,
    answerShare:
      answered.length === 0 ? null : brandMentioned / answered.length,
  };
}

async function observationsForRun(runId: string): Promise<AiObservation[]> {
  return db
    .select({
      provider: aiVisibilityObservations.provider,
      status: aiVisibilityObservations.status,
      outcome: aiVisibilityObservations.outcome,
      mentionCount: aiVisibilityObservations.mentionCount,
      domainCited: aiVisibilityObservations.domainCited,
    })
    .from(aiVisibilityObservations)
    .where(eq(aiVisibilityObservations.runId, runId));
}

export async function loadAiVisibility(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const configs = await db
    .select({
      id: aiVisibilityConfigs.id,
      brandName: aiVisibilityConfigs.brandName,
      domain: aiVisibilityConfigs.domain,
    })
    .from(aiVisibilityConfigs)
    .where(eq(aiVisibilityConfigs.projectId, projectId));
  if (configs.length === 0)
    return { status: "omitted", reason: "not_configured" };

  const loaded: Extract<Section, { key: "ai_visibility" }>["data"]["configs"] =
    [];
  const unavailable: Extract<
    Section,
    { key: "ai_visibility" }
  >["data"]["unavailable"] = [];

  for (const config of configs) {
    const run = await latestCompletedRun(
      aiVisibilityRuns,
      config.id,
      range.periodEnd,
    );
    if (!run?.completedAt) {
      unavailable.push({
        configId: config.id,
        brandName: config.brandName,
        reason: "no_completed_run",
      });
      continue;
    }
    const observations = await observationsForRun(run.id);
    if (observations.length === 0) {
      unavailable.push({
        configId: config.id,
        brandName: config.brandName,
        reason: "no_observations",
      });
      continue;
    }
    const priorRun = await latestCompletedRun(
      aiVisibilityRuns,
      config.id,
      range.compareEnd,
    );
    const prior =
      priorRun?.completedAt && priorRun.id !== run.id
        ? {
            capturedAt: priorRun.completedAt,
            observations: await observationsForRun(priorRun.id),
          }
        : null;
    const providers = [
      ...new Set(observations.map((item) => item.provider)),
    ].toSorted();
    loaded.push({
      configId: config.id,
      brandName: config.brandName,
      domain: config.domain,
      runId: run.id,
      freshness: freshness(run.completedAt, range),
      summary: countObservations(observations),
      previous:
        prior && prior.observations.length > 0
          ? {
              ...countObservations(prior.observations),
              capturedAt: prior.capturedAt,
            }
          : null,
      providers: providers.map((provider) => ({
        provider,
        ...countObservations(
          observations.filter((item) => item.provider === provider),
        ),
      })),
    });
  }

  // Nothing usable at all is an omission, like every other section — an empty
  // section body would say less than the report's data-availability list. The
  // per-config reasons survive only when some configs did load, which is
  // exactly when a reader needs to know the coverage was partial.
  return loaded.length === 0
    ? { status: "omitted", reason: "no_data" }
    : {
        status: "loaded",
        section: {
          key: "ai_visibility",
          data: { configs: loaded, unavailable },
        },
      };
}

async function rankedCellCount(runId: string) {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(geoGridCells)
    .where(
      and(eq(geoGridCells.runId, runId), isNotNull(geoGridCells.position)),
    );
  return Number(rows[0]?.value ?? 0);
}

type GeoGridRunRow = typeof geoGridRuns.$inferSelect;

async function geoGridMetrics(run: GeoGridRunRow) {
  return {
    cellsTotal: run.cellsTotal,
    cellsCompleted: run.cellsCompleted,
    rankedCells: await rankedCellCount(run.id),
    averageRank: run.averageRank,
    topThreeCoverage: run.topThreeCoverage,
    topTenCoverage: run.topTenCoverage,
    topTwentyCoverage: run.topTwentyCoverage,
  };
}

export async function loadLocalGeoGrid(
  projectId: string,
  range: DateRange,
): Promise<SectionLoadResult> {
  const configs = await db
    .select({
      id: geoGridConfigs.id,
      keyword: geoGridConfigs.keyword,
      device: geoGridConfigs.device,
      gridSize: geoGridConfigs.gridSize,
      radiusMeters: geoGridConfigs.radiusMeters,
      businessName: localBusinessProfiles.name,
    })
    .from(geoGridConfigs)
    .innerJoin(
      localBusinessProfiles,
      eq(geoGridConfigs.profileId, localBusinessProfiles.id),
    )
    .where(eq(geoGridConfigs.projectId, projectId));
  if (configs.length === 0)
    return { status: "omitted", reason: "not_configured" };

  const loaded: Extract<Section, { key: "local_geo_grid" }>["data"]["configs"] =
    [];
  const unavailable: Extract<
    Section,
    { key: "local_geo_grid" }
  >["data"]["unavailable"] = [];

  for (const config of configs) {
    const run = await latestCompletedRun(
      geoGridRuns,
      config.id,
      range.periodEnd,
    );
    if (!run?.completedAt) {
      unavailable.push({
        configId: config.id,
        keyword: config.keyword,
        reason: "no_completed_run",
      });
      continue;
    }
    if (run.cellsCompleted === 0) {
      unavailable.push({
        configId: config.id,
        keyword: config.keyword,
        reason: "no_cells",
      });
      continue;
    }
    const priorRun = await latestCompletedRun(
      geoGridRuns,
      config.id,
      range.compareEnd,
    );
    loaded.push({
      configId: config.id,
      keyword: config.keyword,
      businessName: config.businessName,
      device: config.device,
      gridSize: config.gridSize,
      radiusMeters: config.radiusMeters,
      runId: run.id,
      freshness: freshness(run.completedAt, range),
      summary: await geoGridMetrics(run),
      previous:
        priorRun?.completedAt && priorRun.id !== run.id
          ? {
              ...(await geoGridMetrics(priorRun)),
              capturedAt: priorRun.completedAt,
            }
          : null,
    });
  }

  return loaded.length === 0
    ? { status: "omitted", reason: "no_data" }
    : {
        status: "loaded",
        section: {
          key: "local_geo_grid",
          data: { configs: loaded, unavailable },
        },
      };
}
