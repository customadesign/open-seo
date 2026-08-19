/* eslint-disable max-lines -- Grid planning, evidence matching, and metered execution stay colocated because they share one ranking contract. */
import type { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { estimateScheduledGeoGridCost } from "@/shared/local-seo";
import type {
  createGeoGridConfigSchema,
  GeoGridMatchedBy,
} from "@/types/schemas/local-seo";
import { geoGridAggregateResultSchema } from "@/types/schemas/local-seo";

type CreateGeoGridConfigInput = z.infer<typeof createGeoGridConfigSchema>;
type GeoGridScheduleInterval = GeoGridConfig["scheduleInterval"];

const EARTH_RADIUS_METERS = 6_371_008.8;
const GEO_GRID_STALE_RUN_MS = 30 * 60 * 1_000;
const GEO_GRID_RETRY_WINDOW_MS = 60 * 60 * 1_000;
const GEO_GRID_COORDINATE_TOLERANCE = 1e-4;

type GeoGridConfig = NonNullable<
  Awaited<ReturnType<typeof LocalSeoRepository.getGeoGridConfig>>
>;
type LocalBusinessProfile = NonNullable<
  Awaited<ReturnType<typeof LocalSeoRepository.getProfileById>>
>;

export function computeNextGeoGridRun(
  interval: Exclude<GeoGridScheduleInterval, "manual">,
  anchor: string | Date,
) {
  const next = new Date(anchor);
  if (!Number.isFinite(next.getTime())) {
    throw new AppError("VALIDATION_ERROR", "Invalid geo-grid schedule anchor");
  }
  if (interval === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (interval === "monthly") {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const daysInMonth = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next.setUTCDate(Math.min(day, daysInMonth));
  }
  return next.toISOString();
}

/**
 * The first occurrence strictly after `now`, skipping any the deployment
 * missed. Advancing one interval at a time would leave a config that was due
 * while the app was down still due on the next tick, so every tick would start
 * another metered grid until the schedule caught up — a self-host offline for
 * a week bills a week of daily grids in under an hour. Missed occurrences are
 * dropped, not queued: a geo-grid measures rankings now.
 */
export function nextFutureGeoGridRun(
  interval: Exclude<GeoGridScheduleInterval, "manual">,
  anchor: string | Date,
  now: Date = new Date(),
) {
  let next = computeNextGeoGridRun(interval, anchor);
  // Bounded so a corrupt anchor can't spin: daily × 4000 covers ~10 years,
  // beyond which the schedule is re-anchored to now.
  for (let step = 0; step < 4_000 && new Date(next) <= now; step += 1) {
    next = computeNextGeoGridRun(interval, next);
  }
  return new Date(next) <= now ? computeNextGeoGridRun(interval, now) : next;
}

interface PlannedGeoGridCell {
  rowIndex: number;
  columnIndex: number;
  latitude: number;
  longitude: number;
}

interface GeoGridRankCell {
  position: number | null;
}

interface StoredGeoGridCell extends GeoGridRankCell {
  rowIndex: number;
  columnIndex: number;
  latitude: number;
  longitude: number;
  matchedBy: GeoGridMatchedBy;
  resultTitle: string | null;
  resultUrl: string | null;
  providerResultId: string | null;
}

interface LocalResult {
  [key: string]: unknown;
  rank_group?: unknown;
  rank_absolute?: unknown;
  title?: unknown;
  url?: unknown;
  domain?: unknown;
  phone?: unknown;
  place_id?: unknown;
  cid?: unknown;
  feature_id?: unknown;
}

interface BusinessMatchTarget {
  name: string;
  phone: string;
  websiteUrl: string;
  googlePlaceId: string | null;
  googleCid: string | null;
}

type LocalResultMatch = {
  matchedBy: GeoGridMatchedBy;
  position: number | null;
  resultTitle: string | null;
  resultUrl: string | null;
  providerResultId: string | null;
};

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(7));
}

function cellCoordinateKey(
  cell: Pick<PlannedGeoGridCell, "rowIndex" | "columnIndex">,
) {
  return `${cell.rowIndex}:${cell.columnIndex}`;
}

function matchesPlannedCoordinate(
  stored: StoredGeoGridCell,
  planned: PlannedGeoGridCell,
) {
  return (
    stored.rowIndex === planned.rowIndex &&
    stored.columnIndex === planned.columnIndex &&
    Math.abs(stored.latitude - planned.latitude) <
      GEO_GRID_COORDINATE_TOLERANCE &&
    Math.abs(stored.longitude - planned.longitude) <
      GEO_GRID_COORDINATE_TOLERANCE
  );
}

/**
 * Plan an odd square grid. `radiusMeters` is the center-to-edge distance on
 * each axis, so corners are farther by sqrt(2); this keeps rows and columns
 * evenly spaced and the configured center exact.
 */
export function planGeoGrid(input: {
  centerLatitude: number;
  centerLongitude: number;
  gridSize: number;
  radiusMeters: number;
}): PlannedGeoGridCell[] {
  if (input.gridSize < 3 || input.gridSize % 2 !== 1) {
    throw new AppError("VALIDATION_ERROR", "Grid size must be odd and >= 3");
  }
  const middle = (input.gridSize - 1) / 2;
  const step = input.radiusMeters / middle;
  const latitudeRadians = toRadians(input.centerLatitude);
  const longitudeMetersPerRadian =
    EARTH_RADIUS_METERS * Math.cos(latitudeRadians);
  if (Math.abs(longitudeMetersPerRadian) < 1) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Geo-grid center is too close to a pole",
    );
  }

  const cells: PlannedGeoGridCell[] = [];
  for (let rowIndex = 0; rowIndex < input.gridSize; rowIndex += 1) {
    // Row 0 is north/top; latitude decreases as rowIndex increases.
    const northMeters = (middle - rowIndex) * step;
    for (let columnIndex = 0; columnIndex < input.gridSize; columnIndex += 1) {
      const eastMeters = (columnIndex - middle) * step;
      cells.push({
        rowIndex,
        columnIndex,
        latitude: roundCoordinate(
          input.centerLatitude + toDegrees(northMeters / EARTH_RADIUS_METERS),
        ),
        longitude: roundCoordinate(
          input.centerLongitude +
            toDegrees(eastMeters / longitudeMetersPerRadian),
        ),
      });
    }
  }
  return cells;
}

export function aggregateGeoGridRanks(cells: GeoGridRankCell[]) {
  const positions = cells
    .map((cell) => cell.position)
    .filter((position): position is number => position != null);
  const total = cells.length;
  const coverage = (cutoff: number) =>
    total === 0
      ? 0
      : positions.filter((position) => position <= cutoff).length / total;
  return geoGridAggregateResultSchema.parse({
    cellsTotal: total,
    cellsRanked: positions.length,
    averageRank:
      positions.length === 0
        ? null
        : positions.reduce((sum, position) => sum + position, 0) /
          positions.length,
    topThreeCoverage: coverage(3),
    topTenCoverage: coverage(10),
    topTwentyCoverage: coverage(20),
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDigits(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function normalizeName(value: string | null) {
  return (
    value
      ?.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(
        /\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd)\b/g,
        " ",
      )
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ") ?? ""
  );
}

function normalizedDomain(value: string | null) {
  if (!value) return "";
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "");
  }
}

function resultMatch(result: LocalResult, matchedBy: GeoGridMatchedBy) {
  return {
    matchedBy,
    position:
      numberValue(result.rank_group) ?? numberValue(result.rank_absolute),
    resultTitle: stringValue(result.title),
    resultUrl: stringValue(result.url),
    providerResultId:
      stringValue(result.place_id) ??
      stringValue(result.cid) ??
      stringValue(result.feature_id),
  } satisfies LocalResultMatch;
}

/** Strong identifiers always win; weak name matching is the final fallback. */
export function findLocalBusinessResult(
  target: BusinessMatchTarget,
  results: Record<string, unknown>[],
): { result: Record<string, unknown>; matchedBy: GeoGridMatchedBy } | null {
  const rows = results as LocalResult[];
  const targetPlaceId = target.googlePlaceId?.trim() ?? "";
  if (targetPlaceId) {
    const row = rows.find(
      (item) => stringValue(item.place_id) === targetPlaceId,
    );
    if (row) return { result: row, matchedBy: "place_id" };
  }

  const targetCid = target.googleCid?.trim() ?? "";
  if (targetCid) {
    const row = rows.find((item) => stringValue(item.cid) === targetCid);
    if (row) return { result: row, matchedBy: "cid" };
  }

  const phone = normalizeDigits(target.phone);
  if (phone) {
    const row = rows.find(
      (item) => normalizeDigits(stringValue(item.phone)) === phone,
    );
    if (row) return { result: row, matchedBy: "phone" };
  }

  const domain = normalizedDomain(target.websiteUrl);
  if (domain) {
    const row = rows.find((item) => {
      const itemDomains = [item.domain, item.url]
        .map((value) => normalizedDomain(stringValue(value)))
        .filter(Boolean);
      return itemDomains.some(
        (itemDomain) =>
          itemDomain === domain || itemDomain.endsWith(`.${domain}`),
      );
    });
    if (row) return { result: row, matchedBy: "domain" };
  }

  const name = normalizeName(target.name);
  if (name) {
    const row = rows.find(
      (item) => normalizeName(stringValue(item.title)) === name,
    );
    if (row) return { result: row, matchedBy: "name" };
  }

  return null;
}

export function matchLocalBusinessResult(
  target: BusinessMatchTarget,
  results: Record<string, unknown>[],
): LocalResultMatch {
  const match = findLocalBusinessResult(target, results);
  if (match) {
    return resultMatch(match.result as LocalResult, match.matchedBy);
  }

  return {
    matchedBy: "none",
    position: null,
    resultTitle: null,
    resultUrl: null,
    providerResultId: null,
  };
}

async function createConfig(input: CreateGeoGridConfigInput) {
  const profile = await LocalSeoRepository.getProfileById(
    input.profileId,
    input.projectId,
  );
  if (!profile) {
    throw new AppError("NOT_FOUND", "Local business profile not found");
  }
  const { maxEstimatedScheduledCheckCredits, ...config } = input;
  if (config.scheduleInterval !== "manual") {
    const estimate = estimateScheduledGeoGridCost(
      config.gridSize,
      config.scheduleInterval,
      await isHostedServerAuthMode(),
    );
    if (
      maxEstimatedScheduledCheckCredits == null ||
      estimate.costCredits > maxEstimatedScheduledCheckCredits
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        `This recurring geo-grid costs an estimated ${estimate.costCredits} credits per run, above the approved maximum of ${maxEstimatedScheduledCheckCredits ?? 0}. Review the current estimate and approve it again.`,
      );
    }
  }
  return LocalSeoRepository.createGeoGridConfig({
    id: crypto.randomUUID(),
    ...config,
    nextRunAt:
      config.scheduleInterval === "manual"
        ? null
        : computeNextGeoGridRun(config.scheduleInterval, new Date()),
  });
}

async function getResumableGeoGridRun(input: {
  config: GeoGridConfig;
  profile: LocalBusinessProfile;
  plan: PlannedGeoGridCell[];
  projectId: string;
  runId?: string;
}) {
  const failedRun = input.runId
    ? await LocalSeoRepository.getGeoGridRun(input.runId, input.projectId)
    : await LocalSeoRepository.getLatestFailedGeoGridRun(
        input.config.id,
        input.projectId,
      );
  if (
    !failedRun ||
    failedRun.status !== "failed" ||
    failedRun.configId !== input.config.id
  ) {
    return null;
  }
  const completedAt = failedRun.completedAt;
  if (!completedAt) return null;

  const startedAt = Date.parse(failedRun.startedAt);
  const failedAt = Date.parse(completedAt);
  const profileUpdatedAt = Date.parse(input.profile.updatedAt);
  const lastCompletedAt = input.config.lastRunAt
    ? Date.parse(input.config.lastRunAt)
    : null;
  const now = Date.now();
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(failedAt) ||
    !Number.isFinite(profileUpdatedAt) ||
    failedAt < startedAt ||
    failedAt > now ||
    now - startedAt < 0 ||
    now - startedAt > GEO_GRID_RETRY_WINDOW_MS ||
    profileUpdatedAt > startedAt ||
    (lastCompletedAt != null &&
      (!Number.isFinite(lastCompletedAt) || lastCompletedAt > failedAt)) ||
    failedRun.gridSize !== input.config.gridSize ||
    failedRun.radiusMeters !== input.config.radiusMeters ||
    failedRun.cellsTotal !== input.plan.length
  ) {
    return null;
  }

  const plannedByCoordinate = new Map(
    input.plan.map((cell) => [cellCoordinateKey(cell), cell]),
  );
  const storedCells = await LocalSeoRepository.getGeoGridCells(
    failedRun.id,
    input.projectId,
  );
  if (storedCells.length === 0 || storedCells.length > input.plan.length) {
    return null;
  }

  const storedByCoordinate = new Map<string, StoredGeoGridCell>();
  for (const stored of storedCells) {
    const key = cellCoordinateKey(stored);
    const planned = plannedByCoordinate.get(key);
    if (
      !planned ||
      storedByCoordinate.has(key) ||
      !matchesPlannedCoordinate(stored, planned)
    ) {
      return null;
    }
    storedByCoordinate.set(key, stored);
  }

  return {
    run: failedRun,
    observedCompletedAt: completedAt,
    cells: storedByCoordinate,
  };
}

async function assertGeoGridAttemptActive(input: {
  runId: string;
  projectId: string;
  attemptToken: string;
}) {
  const current = await LocalSeoRepository.getGeoGridRun(
    input.runId,
    input.projectId,
  );
  if (
    !current ||
    (current.status !== "pending" && current.status !== "running") ||
    current.attemptToken !== input.attemptToken
  ) {
    throw new AppError("CONFLICT", "Geo-grid retry lease changed");
  }
}

async function runGrid(input: {
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  resumeRunId?: string;
  skipFailedRunResume?: boolean;
}) {
  const config = await LocalSeoRepository.getGeoGridConfig(
    input.configId,
    input.projectId,
  );
  if (!config) throw new AppError("NOT_FOUND", "Geo-grid config not found");
  let activeRun = await LocalSeoRepository.getActiveGeoGridRun(
    config.id,
    input.projectId,
  );
  if (activeRun) {
    const attemptStartedAt = Date.parse(activeRun.attemptStartedAt);
    const stale =
      !Number.isFinite(attemptStartedAt) ||
      Date.now() - attemptStartedAt >= GEO_GRID_STALE_RUN_MS;
    if (!stale) return { started: false as const, run: activeRun };

    const completedAt = new Date().toISOString();
    const released = await LocalSeoRepository.failStaleGeoGridRun({
      runId: activeRun.id,
      projectId: input.projectId,
      observedStartedAt: activeRun.startedAt,
      observedAttemptToken: activeRun.attemptToken,
      observedAttemptStartedAt: activeRun.attemptStartedAt,
      completedAt,
    });
    if (!released) {
      const observedRun = await LocalSeoRepository.getGeoGridRun(
        activeRun.id,
        input.projectId,
      );
      if (observedRun) return { started: false as const, run: observedRun };
      activeRun = await LocalSeoRepository.getActiveGeoGridRun(
        config.id,
        input.projectId,
      );
      if (activeRun) return { started: false as const, run: activeRun };
      throw new AppError(
        "CONFLICT",
        "Geo-grid run changed concurrently; retry shortly",
      );
    }
  }
  const profile = await LocalSeoRepository.getProfileById(
    config.profileId,
    input.projectId,
  );
  if (!profile) {
    throw new AppError("NOT_FOUND", "Local business profile not found");
  }

  const plan = planGeoGrid(config);
  if (input.resumeRunId && input.skipFailedRunResume) {
    throw new AppError(
      "VALIDATION_ERROR",
      "An exact geo-grid retry cannot also skip failed-run recovery",
    );
  }
  const resumable = input.skipFailedRunResume
    ? null
    : await getResumableGeoGridRun({
        config,
        profile,
        plan,
        projectId: input.projectId,
        runId: input.resumeRunId,
      });
  if (input.resumeRunId && !resumable) {
    throw new AppError(
      "CONFLICT",
      "The scheduled geo-grid attempt is no longer safe to resume",
    );
  }
  let run = null;
  let cellsByCoordinate = new Map<string, StoredGeoGridCell>();
  if (resumable) {
    const attemptToken = crypto.randomUUID();
    const attemptStartedAt = new Date().toISOString();
    try {
      run = await LocalSeoRepository.claimFailedGeoGridRun({
        runId: resumable.run.id,
        configId: config.id,
        projectId: input.projectId,
        observedStartedAt: resumable.run.startedAt,
        observedCompletedAt: resumable.observedCompletedAt,
        observedAttemptToken: resumable.run.attemptToken,
        attemptToken,
        attemptStartedAt,
      });
    } catch (error) {
      const blockingRun = await LocalSeoRepository.getActiveGeoGridRun(
        config.id,
        input.projectId,
      );
      if (blockingRun) return { started: false as const, run: blockingRun };
      throw error;
    }
    if (!run) {
      const observedRun = await LocalSeoRepository.getGeoGridRun(
        resumable.run.id,
        input.projectId,
      );
      if (observedRun) return { started: false as const, run: observedRun };
      const blockingRun = await LocalSeoRepository.getActiveGeoGridRun(
        config.id,
        input.projectId,
      );
      if (blockingRun) return { started: false as const, run: blockingRun };
      throw new AppError(
        "CONFLICT",
        "Geo-grid retry changed concurrently; retry shortly",
      );
    }
    cellsByCoordinate = resumable.cells;
  }

  if (!run) {
    const attemptStartedAt = new Date().toISOString();
    run = await LocalSeoRepository.createGeoGridRun({
      id: crypto.randomUUID(),
      configId: config.id,
      projectId: input.projectId,
      status: "running",
      attemptToken: crypto.randomUUID(),
      attemptStartedAt,
      gridSize: config.gridSize,
      radiusMeters: config.radiusMeters,
      cellsTotal: plan.length,
      startedAt: attemptStartedAt,
    });
    if (!run) {
      const blockingRun = await LocalSeoRepository.getActiveGeoGridRun(
        config.id,
        input.projectId,
      );
      if (!blockingRun) {
        throw new AppError(
          "CONFLICT",
          "Geo-grid run could not be created; retry shortly",
        );
      }
      return { started: false as const, run: blockingRun };
    }
  }

  const client = createDataforseoClient(input.billingCustomer);
  try {
    // Sequential calls keep request/billing attribution simple and respect the
    // provider's live SERP burst limits; every new call uses the metered client.
    // Persist each paid result immediately. A short retry resumes one failed
    // run in place, preserving its original run/cell timestamps and evidence.
    const cells = plan.flatMap((cell) => {
      const stored = cellsByCoordinate.get(cellCoordinateKey(cell));
      return stored ? [stored] : [];
    });
    if (cells.length > 0) {
      const updatedRun = await LocalSeoRepository.updateGeoGridRun(
        run.id,
        input.projectId,
        run.attemptToken,
        { cellsCompleted: cells.length },
      );
      if (!updatedRun) {
        throw new AppError("CONFLICT", "Geo-grid retry lease changed");
      }
    }

    for (const cell of plan) {
      if (cellsByCoordinate.has(cellCoordinateKey(cell))) continue;
      await assertGeoGridAttemptActive({
        runId: run.id,
        projectId: input.projectId,
        attemptToken: run.attemptToken,
      });
      const results = await client.serp.local({
        keyword: config.keyword,
        locationCoordinate: `${cell.latitude},${cell.longitude},15z`,
        languageCode: config.languageCode,
        searchType: "maps",
        device: config.device,
        depth: 20,
        searchPlaces: false,
        creditFeature: "local_seo",
      });
      const match = matchLocalBusinessResult(profile, results);
      const completedCell = {
        id: crypto.randomUUID(),
        runId: run.id,
        ...cell,
        ...match,
      };
      const insertedCell = await LocalSeoRepository.insertGeoGridCellClaimed({
        cell: completedCell,
        projectId: input.projectId,
        attemptToken: run.attemptToken,
      });
      if (!insertedCell) {
        throw new AppError("CONFLICT", "Geo-grid retry lease changed");
      }
      cells.push(completedCell);
      const updatedRun = await LocalSeoRepository.updateGeoGridRun(
        run.id,
        input.projectId,
        run.attemptToken,
        { cellsCompleted: cells.length },
      );
      if (!updatedRun) {
        throw new AppError("CONFLICT", "Geo-grid retry lease changed");
      }
    }

    const aggregates = aggregateGeoGridRanks(cells);
    const completedAt = new Date().toISOString();
    const completedRun = await LocalSeoRepository.updateGeoGridRun(
      run.id,
      input.projectId,
      run.attemptToken,
      {
        status: "completed",
        cellsCompleted: cells.length,
        averageRank: aggregates.averageRank,
        topThreeCoverage: aggregates.topThreeCoverage,
        topTenCoverage: aggregates.topTenCoverage,
        topTwentyCoverage: aggregates.topTwentyCoverage,
        completedAt,
      },
    );
    if (!completedRun) {
      throw new AppError("CONFLICT", "Geo-grid retry lease changed");
    }
    await LocalSeoRepository.markGeoGridConfigRun(
      config.id,
      input.projectId,
      completedAt,
    );
    return { started: true as const, run: completedRun, cells };
  } catch (error) {
    await LocalSeoRepository.updateGeoGridRun(
      run.id,
      input.projectId,
      run.attemptToken,
      {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Geo-grid run failed",
        completedAt: new Date().toISOString(),
      },
    );
    if (error instanceof AppError) {
      throw new AppError(error.code, error.message, {
        ...error.details,
        geoGridRunId: run.id,
      });
    }
    throw error;
  }
}

async function getHistory(input: {
  projectId: string;
  configId?: string;
  runId?: string;
  limit: number;
}) {
  if (input.runId) {
    const run = await LocalSeoRepository.getGeoGridRun(
      input.runId,
      input.projectId,
    );
    if (!run) throw new AppError("NOT_FOUND", "Geo-grid run not found");
    return {
      runs: [run],
      cells: await LocalSeoRepository.getGeoGridCells(run.id, input.projectId),
    };
  }
  if (input.configId) {
    const config = await LocalSeoRepository.getGeoGridConfig(
      input.configId,
      input.projectId,
    );
    if (!config) throw new AppError("NOT_FOUND", "Geo-grid config not found");
  }
  return {
    runs: await LocalSeoRepository.getGeoGridRuns(input.projectId, input),
    cells: [],
  };
}

export const GeoGridService = {
  createConfig,
  runGrid,
  getHistory,
} as const;
