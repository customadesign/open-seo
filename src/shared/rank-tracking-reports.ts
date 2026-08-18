export const RANK_BANDS = [
  "top3",
  "top4to10",
  "top11to20",
  "top21to100",
  "notInTop100",
] as const;

export type RankBand = (typeof RANK_BANDS)[number];

export const RANK_BAND_LABELS: Record<RankBand, string> = {
  top3: "1–3",
  top4to10: "4–10",
  top11to20: "11–20",
  top21to100: "21–100",
  notInTop100: "Out of top 100",
};

/** SERP item types that are treated as features (not the organic listing). */
export const NOTABLE_SERP_FEATURES = [
  "featured_snippet",
  "people_also_ask",
  "ai_overview",
  "local_pack",
  "knowledge_panel",
  "video",
  "images",
  "shopping",
  "top_stories",
] as const;

export type NotableSerpFeature = (typeof NOTABLE_SERP_FEATURES)[number];

const NOTABLE_SERP_FEATURE_SET = new Set<string>(NOTABLE_SERP_FEATURES);

export function isNotableSerpFeature(
  feature: string,
): feature is NotableSerpFeature {
  return NOTABLE_SERP_FEATURE_SET.has(feature);
}

export function notableSerpFeatures(features: readonly string[]): string[] {
  return features.filter(isNotableSerpFeature);
}

/**
 * Position band for a stored snapshot. `null` means the keyword was not found
 * within the tracked depth, which this report treats as out of the top 100.
 */
export function rankBand(position: number | null): RankBand {
  if (position == null || position < 1 || position > 100) return "notInTop100";
  if (position <= 3) return "top3";
  if (position <= 10) return "top4to10";
  if (position <= 20) return "top11to20";
  return "top21to100";
}

export type RankBandCounts = Record<RankBand, number>;

export function emptyRankBandCounts(): RankBandCounts {
  return {
    top3: 0,
    top4to10: 0,
    top11to20: 0,
    top21to100: 0,
    notInTop100: 0,
  };
}

export function countRankBands(
  positions: ReadonlyArray<number | null>,
): RankBandCounts {
  const counts = emptyRankBandCounts();
  for (const position of positions) {
    counts[rankBand(position)] += 1;
  }
  return counts;
}

export type RankBandMovement = Record<
  RankBand,
  { entered: number; left: number }
>;

/**
 * Keywords that moved into / out of each band between two snapshots of the
 * same keyword set. A keyword that stayed in the same band is neither.
 */
export function rankBandMovement(
  current: ReadonlyArray<{ id: string; position: number | null }>,
  previous: ReadonlyArray<{ id: string; position: number | null }>,
): RankBandMovement {
  const previousById = new Map(
    previous.map((row) => [row.id, rankBand(row.position)]),
  );
  const movement: RankBandMovement = {
    top3: { entered: 0, left: 0 },
    top4to10: { entered: 0, left: 0 },
    top11to20: { entered: 0, left: 0 },
    top21to100: { entered: 0, left: 0 },
    notInTop100: { entered: 0, left: 0 },
  };

  const seen = new Set<string>();
  for (const row of current) {
    seen.add(row.id);
    const currentBand = rankBand(row.position);
    const previousBand = previousById.get(row.id);
    if (previousBand == null) {
      movement[currentBand].entered += 1;
      continue;
    }
    if (previousBand === currentBand) continue;
    movement[previousBand].left += 1;
    movement[currentBand].entered += 1;
  }

  for (const row of previous) {
    if (seen.has(row.id)) continue;
    movement[rankBand(row.position)].left += 1;
  }

  return movement;
}

/**
 * Collapse protocol, www, trailing slash, query, and fragment so a redirect
 * target matches the URL it replaced.
 */
export function normalizeRankingUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";
  try {
    const parsed = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    return `${host}${path.toLowerCase()}`;
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

export type PageReportRow = {
  url: string;
  normalizedUrl: string;
  keywordCount: number;
  bestPosition: number | null;
  averagePosition: number | null;
  estimatedTraffic: number | null;
  previousKeywordCount: number;
  keywordCountChange: number;
  previousAveragePosition: number | null;
  averagePositionChange: number | null;
  previousEstimatedTraffic: number | null;
  estimatedTrafficChange: number | null;
};

export type PageSnapshotRow = {
  trackingKeywordId: string;
  url: string | null;
  position: number | null;
  searchVolume: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Group latest snapshots by landing page. Traffic is filled in by the caller
 * with the shared CTR helper so this stays a pure grouping function.
 */
export function groupSnapshotsByPage(
  current: ReadonlyArray<PageSnapshotRow>,
  previous: ReadonlyArray<PageSnapshotRow>,
  traffic: (
    searchVolume: number | null,
    position: number | null,
  ) => number | null,
): PageReportRow[] {
  const currentGroups = new Map<string, PageSnapshotRow[]>();
  const previousGroups = new Map<string, PageSnapshotRow[]>();
  const displayUrl = new Map<string, string>();

  for (const row of current) {
    if (row.url == null || row.url.length === 0) continue;
    const key = normalizeRankingUrl(row.url);
    if (key.length === 0) continue;
    const group = currentGroups.get(key) ?? [];
    group.push(row);
    currentGroups.set(key, group);
    displayUrl.set(key, row.url);
  }

  for (const row of previous) {
    if (row.url == null || row.url.length === 0) continue;
    const key = normalizeRankingUrl(row.url);
    if (key.length === 0) continue;
    const group = previousGroups.get(key) ?? [];
    group.push(row);
    previousGroups.set(key, group);
    if (!displayUrl.has(key)) displayUrl.set(key, row.url);
  }

  const keys = new Set([...currentGroups.keys(), ...previousGroups.keys()]);
  const pages: PageReportRow[] = [];

  for (const key of keys) {
    const now = currentGroups.get(key) ?? [];
    const before = previousGroups.get(key) ?? [];
    const rankingNow = now
      .map((row) => row.position)
      .filter((position): position is number => position != null);
    const rankingBefore = before
      .map((row) => row.position)
      .filter((position): position is number => position != null);
    const nowTraffic = now
      .map((row) => traffic(row.searchVolume, row.position))
      .filter((value): value is number => value != null);
    const beforeTraffic = before
      .map((row) => traffic(row.searchVolume, row.position))
      .filter((value): value is number => value != null);
    const estimatedTraffic =
      nowTraffic.length > 0
        ? nowTraffic.reduce((sum, value) => sum + value, 0)
        : null;
    const previousEstimatedTraffic =
      beforeTraffic.length > 0
        ? beforeTraffic.reduce((sum, value) => sum + value, 0)
        : null;
    const averagePosition = average(rankingNow);
    const previousAveragePosition = average(rankingBefore);

    pages.push({
      url: displayUrl.get(key) ?? key,
      normalizedUrl: key,
      keywordCount: now.length,
      bestPosition: rankingNow.length > 0 ? Math.min(...rankingNow) : null,
      averagePosition,
      estimatedTraffic,
      previousKeywordCount: before.length,
      keywordCountChange: now.length - before.length,
      previousAveragePosition,
      averagePositionChange:
        averagePosition != null && previousAveragePosition != null
          ? previousAveragePosition - averagePosition
          : null,
      previousEstimatedTraffic,
      estimatedTrafficChange:
        estimatedTraffic != null && previousEstimatedTraffic != null
          ? estimatedTraffic - previousEstimatedTraffic
          : null,
    });
  }

  return pages.toSorted((a, b) => {
    if (b.keywordCount !== a.keywordCount)
      return b.keywordCount - a.keywordCount;
    const aBest = a.bestPosition ?? Number.POSITIVE_INFINITY;
    const bBest = b.bestPosition ?? Number.POSITIVE_INFINITY;
    return aBest - bBest;
  });
}

export type SerpFeatureKeywordRow = {
  trackingKeywordId: string;
  keyword: string;
  position: number | null;
  features: string[];
  previousFeatures: string[];
  gained: string[];
  lost: string[];
};

export function serpFeatureChanges(
  current: ReadonlyArray<{
    trackingKeywordId: string;
    keyword: string;
    position: number | null;
    features: readonly string[];
  }>,
  previousById: ReadonlyMap<string, readonly string[]>,
): SerpFeatureKeywordRow[] {
  return current
    .map((row) => {
      const features = notableSerpFeatures(row.features);
      const previousFeatures = notableSerpFeatures(
        previousById.get(row.trackingKeywordId) ?? [],
      );
      const previousSet = new Set(previousFeatures);
      const currentSet = new Set(features);
      return {
        trackingKeywordId: row.trackingKeywordId,
        keyword: row.keyword,
        position: row.position,
        features,
        previousFeatures,
        gained: features.filter((feature) => !previousSet.has(feature)),
        lost: previousFeatures.filter((feature) => !currentSet.has(feature)),
      };
    })
    .filter(
      (row) =>
        row.features.length > 0 ||
        row.previousFeatures.length > 0 ||
        row.gained.length > 0 ||
        row.lost.length > 0,
    )
    .toSorted((a, b) => a.keyword.localeCompare(b.keyword));
}
