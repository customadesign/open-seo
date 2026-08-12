/* eslint-disable max-lines -- Grid planning, evidence matching, and metered execution stay colocated because they share one ranking contract. */
import type { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import type {
  createGeoGridConfigSchema,
  GeoGridMatchedBy,
} from "@/types/schemas/local-seo";
import { geoGridAggregateResultSchema } from "@/types/schemas/local-seo";

type CreateGeoGridConfigInput = z.infer<typeof createGeoGridConfigSchema>;
type GeoGridScheduleInterval = CreateGeoGridConfigInput["scheduleInterval"];

const EARTH_RADIUS_METERS = 6_371_008.8;
const GEO_GRID_STALE_RUN_MS = 30 * 60 * 1_000;

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

interface PlannedGeoGridCell {
  rowIndex: number;
  columnIndex: number;
  latitude: number;
  longitude: number;
}

interface GeoGridRankCell {
  position: number | null;
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
  return LocalSeoRepository.createGeoGridConfig({
    id: crypto.randomUUID(),
    ...input,
    nextRunAt:
      input.scheduleInterval === "manual"
        ? null
        : computeNextGeoGridRun(input.scheduleInterval, new Date()),
  });
}

async function runGrid(input: {
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
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
    const startedAt = Date.parse(activeRun.startedAt);
    const stale =
      !Number.isFinite(startedAt) ||
      Date.now() - startedAt >= GEO_GRID_STALE_RUN_MS;
    if (!stale) return { started: false as const, run: activeRun };

    const completedAt = new Date().toISOString();
    const released = await LocalSeoRepository.failStaleGeoGridRun({
      runId: activeRun.id,
      projectId: input.projectId,
      observedStartedAt: activeRun.startedAt,
      completedAt,
    });
    if (!released) {
      activeRun = await LocalSeoRepository.getActiveGeoGridRun(
        config.id,
        input.projectId,
      );
      if (activeRun) return { started: false as const, run: activeRun };
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
  const run = await LocalSeoRepository.createGeoGridRun({
    id: crypto.randomUUID(),
    configId: config.id,
    projectId: input.projectId,
    status: "running",
    gridSize: config.gridSize,
    radiusMeters: config.radiusMeters,
    cellsTotal: plan.length,
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

  const client = createDataforseoClient(input.billingCustomer);
  try {
    // Sequential calls keep request/billing attribution simple and respect the
    // provider's live SERP burst limits; every call uses the metered client.
    const cells = [];
    for (const cell of plan) {
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
      cells.push({
        id: crypto.randomUUID(),
        runId: run.id,
        ...cell,
        ...match,
      });
    }

    await LocalSeoRepository.insertGeoGridCells(cells);
    const aggregates = aggregateGeoGridRanks(cells);
    const completedAt = new Date().toISOString();
    const completedRun = await LocalSeoRepository.updateGeoGridRun(
      run.id,
      input.projectId,
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
    await LocalSeoRepository.markGeoGridConfigRun(
      config.id,
      input.projectId,
      completedAt,
    );
    return { started: true as const, run: completedRun ?? run, cells };
  } catch (error) {
    await LocalSeoRepository.updateGeoGridRun(run.id, input.projectId, {
      status: "failed",
      errorMessage:
        error instanceof Error ? error.message : "Geo-grid run failed",
      completedAt: new Date().toISOString(),
    });
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
