import { LOCATIONS } from "@/client/features/keywords/locations";
import { devicesLabel } from "@/shared/rank-tracking";
import type {
  RankTrackingConfig,
  RankTrackingRow,
} from "@/types/schemas/rank-tracking";

export type Filters = {
  include: string;
  exclude: string;
  minDesktopPos: string;
  maxDesktopPos: string;
  minMobilePos: string;
  maxMobilePos: string;
  minVolume: string;
  maxVolume: string;
  minKd: string;
  maxKd: string;
  minCpc: string;
  maxCpc: string;
};

type DomainFilterableConfig = Pick<
  RankTrackingConfig,
  "domain" | "devices" | "locationCode"
>;

export type DomainListFilters = {
  query: string;
  device: "all" | RankTrackingConfig["devices"];
  locationCode: string;
};

type DomainListFilterOption = {
  value: string;
  label: string;
};

export const EMPTY_FILTERS: Filters = {
  include: "",
  exclude: "",
  minDesktopPos: "",
  maxDesktopPos: "",
  minMobilePos: "",
  maxMobilePos: "",
  minVolume: "",
  maxVolume: "",
  minKd: "",
  maxKd: "",
  minCpc: "",
  maxCpc: "",
};

export const EMPTY_DOMAIN_LIST_FILTERS: DomainListFilters = {
  query: "",
  device: "all",
  locationCode: "all",
};

const DEVICE_FILTER_ORDER: RankTrackingConfig["devices"][] = [
  "both",
  "desktop",
  "mobile",
];

export function applyDomainListFilters<T extends DomainFilterableConfig>(
  configs: T[],
  filters: DomainListFilters,
): T[] {
  const query = filters.query.trim().toLowerCase();
  const locationCode =
    filters.locationCode === "all" ? null : Number(filters.locationCode);

  return configs.filter((config) => {
    if (query && !config.domain.toLowerCase().includes(query)) return false;

    if (filters.device !== "all" && config.devices !== filters.device) {
      return false;
    }

    if (locationCode !== null && config.locationCode !== locationCode) {
      return false;
    }

    return true;
  });
}

export function getDomainListFilterOptions(configs: DomainFilterableConfig[]): {
  devices: DomainListFilterOption[];
  locations: DomainListFilterOption[];
} {
  const deviceValues = new Set(configs.map((config) => config.devices));
  const devices = DEVICE_FILTER_ORDER.filter((device) =>
    deviceValues.has(device),
  ).map((device) => ({
    value: device,
    label: devicesLabel(device),
  }));

  const locationMap = new Map<number, string>();
  for (const config of configs) {
    locationMap.set(
      config.locationCode,
      LOCATIONS[config.locationCode] ?? String(config.locationCode),
    );
  }

  const locations = Array.from(locationMap, ([code, label]) => ({
    value: String(code),
    label,
  })).toSorted((a, b) => a.label.localeCompare(b.label));

  return { devices, locations };
}

export function applyFilters(
  rows: RankTrackingRow[],
  filters: Filters,
): RankTrackingRow[] {
  const includeTerms = filters.include
    ? filters.include
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const excludeTerms = filters.exclude
    ? filters.exclude
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return rows.filter((row) => {
    const kw = row.keyword.toLowerCase();

    if (includeTerms.length > 0 && !includeTerms.some((t) => kw.includes(t)))
      return false;

    if (excludeTerms.some((t) => kw.includes(t))) return false;

    if (
      !matchesPositionFilter(
        row.desktop.position,
        filters.minDesktopPos,
        filters.maxDesktopPos,
      )
    )
      return false;

    if (
      !matchesPositionFilter(
        row.mobile.position,
        filters.minMobilePos,
        filters.maxMobilePos,
      )
    )
      return false;

    if (
      !matchesMetricRangeFilter(
        row.searchVolume,
        filters.minVolume,
        filters.maxVolume,
      )
    )
      return false;

    if (
      !matchesMetricRangeFilter(
        row.keywordDifficulty,
        filters.minKd,
        filters.maxKd,
      )
    )
      return false;

    if (!matchesMetricRangeFilter(row.cpc, filters.minCpc, filters.maxCpc))
      return false;

    return true;
  });
}

export function matchesPositionFilter(
  position: number | null,
  minValue: string,
  maxValue: string,
): boolean {
  if (!minValue && !maxValue) return true;

  const max = maxValue === "" ? Infinity : Number(maxValue);
  if (max === 0) return position === null;

  if (position === null) return false;

  const min = minValue === "" ? 0 : Number(minValue);
  return position >= min && position <= max;
}

export function matchesMetricRangeFilter(
  value: number | null,
  minValue: string,
  maxValue: string,
): boolean {
  if (!minValue && !maxValue) return true;
  if (value === null) return false;

  const min = minValue === "" ? -Infinity : Number(minValue);
  const max = maxValue === "" ? Infinity : Number(maxValue);
  return value >= min && value <= max;
}

export function countActiveFilters(filters: Filters): number {
  let count = 0;
  if (filters.include) count++;
  if (filters.exclude) count++;
  if (filters.minDesktopPos || filters.maxDesktopPos) count++;
  if (filters.minMobilePos || filters.maxMobilePos) count++;
  if (filters.minVolume || filters.maxVolume) count++;
  if (filters.minKd || filters.maxKd) count++;
  if (filters.minCpc || filters.maxCpc) count++;
  return count;
}

export function countActiveDomainListFilters(
  filters: DomainListFilters,
): number {
  let count = 0;
  if (filters.query.trim()) count++;
  if (filters.device !== "all") count++;
  if (filters.locationCode !== "all") count++;
  return count;
}

// ---------------------------------------------------------------------------
// Keyword presets: one-click action lists over the tracked keywords.
// ---------------------------------------------------------------------------

export type KeywordPreset =
  | "all"
  | "workOnNext"
  | "createPage"
  | "dropped"
  | "considerRemoving";

// Rule thresholds, named so they are easy to tune. Reported volume bottoms out
// at 10 for most local terms, so paid-click value (CPC) is the second demand
// signal: advertisers only bid on searches that bring customers.
const STRIKING_DISTANCE_MIN = 11;
const STRIKING_DISTANCE_MAX = 30;
const DEMAND_MIN_VOLUME = 20;
const DEMAND_MIN_CPC = 2;
const PAGE_MISSING_BEYOND = 30;
const HOMEPAGE_ONLY_BEYOND = 10;

export const KEYWORD_PRESETS: ReadonlyArray<{
  id: KeywordPreset;
  label: string;
  description: string;
}> = [
  { id: "all", label: "All", description: "Every tracked keyword" },
  {
    id: "workOnNext",
    label: "Work on next",
    description: `Positions ${STRIKING_DISTANCE_MIN}–${STRIKING_DISTANCE_MAX}: closest to page 1, highest volume first`,
  },
  {
    id: "createPage",
    label: "Create a page",
    description: `Volume ${DEMAND_MIN_VOLUME}+ or CPC $${DEMAND_MIN_CPC}+, and not in the top ${PAGE_MISSING_BEYOND} or only the homepage ranks below #${HOMEPAGE_ONLY_BEYOND}`,
  },
  {
    id: "dropped",
    label: "Dropped",
    description:
      "Ranked in an earlier check but not found in the top 100 in the latest one",
  },
  {
    id: "considerRemoving",
    label: "Consider removing",
    description: `Checked in the latest run, never ranked in any check, volume under ${DEMAND_MIN_VOLUME} and CPC under $${DEMAND_MIN_CPC}`,
  },
];

function hasDemand(row: RankTrackingRow): boolean {
  return (
    (row.searchVolume ?? 0) >= DEMAND_MIN_VOLUME ||
    (row.cpc ?? 0) >= DEMAND_MIN_CPC
  );
}

/** Path part of a ranking URL ("/" for the homepage); raw value if unparseable. */
export function toPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function matchesKeywordPreset(
  row: RankTrackingRow,
  preset: KeywordPreset,
  device: "desktop" | "mobile",
): boolean {
  const { position, bestPosition, checkedInLatestCheck, rankingUrl } =
    row[device];

  switch (preset) {
    case "all":
      return true;
    case "workOnNext":
      return (
        position != null &&
        position >= STRIKING_DISTANCE_MIN &&
        position <= STRIKING_DISTANCE_MAX
      );
    case "createPage": {
      if (!hasDemand(row)) return false;
      if (position == null || position > PAGE_MISSING_BEYOND) return true;
      return (
        rankingUrl != null &&
        toPath(rankingUrl) === "/" &&
        position > HOMEPAGE_ONLY_BEYOND
      );
    }
    // Both lists below need a real "not found" from the newest check — a
    // keyword that check skipped has no evidence either way.
    case "dropped":
      return checkedInLatestCheck && position == null && bestPosition != null;
    case "considerRemoving":
      return checkedInLatestCheck && bestPosition == null && !hasDemand(row);
  }
}
