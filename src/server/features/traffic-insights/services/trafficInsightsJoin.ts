import { matchLandingPageKey } from "@/server/lib/landingPageKey";
import type {
  TrafficInsightsKeyword,
  TrafficInsightsPage,
  TrafficInsightsQuery,
} from "./OrganicTrafficInsightsService";

export const QUERIES_PER_PAGE = 15;
const KEYWORDS_PER_PAGE = 15;

export type DraftPage = {
  key: string;
  url: string;
  coverage: Set<"ga4" | "gsc" | "rank_tracking">;
  sessions: number | null;
  engagementRate: number | null;
  keyEvents: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  queries: TrafficInsightsQuery[];
  keywordsByName: Map<string, TrafficInsightsKeyword>;
};

export function emptyPage(key: string, url: string): DraftPage {
  return {
    key,
    url,
    coverage: new Set(),
    sessions: null,
    engagementRate: null,
    keyEvents: null,
    clicks: null,
    impressions: null,
    ctr: null,
    averagePosition: null,
    queries: [],
    keywordsByName: new Map(),
  };
}

export function preferUrl(current: string, next: string): string {
  if (next.startsWith("http") && !current.startsWith("http")) return next;
  return current;
}

export function displayUrl(page: string, host?: string): string {
  if (page.includes("://")) return page;
  if (host) {
    const path = page.startsWith("/") ? page : `/${page}`;
    return `https://${host}${path}`;
  }
  return page;
}

function optionalNumber(
  row: Record<string, string | number | null>,
  name: string,
): number | null {
  const value = row[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addQueries(page: DraftPage, incoming: TrafficInsightsQuery[]): void {
  if (incoming.length === 0) return;
  const byQuery = new Map(page.queries.map((query) => [query.query, query]));
  for (const query of incoming) {
    const existing = byQuery.get(query.query);
    if (!existing) {
      page.queries.push({ ...query });
      continue;
    }
    existing.clicks += query.clicks;
    existing.impressions += query.impressions;
  }
  page.queries = page.queries
    .toSorted((left, right) => right.impressions - left.impressions)
    .slice(0, QUERIES_PER_PAGE);
}

export function addGa4(
  page: DraftPage,
  row: Record<string, string | number | null>,
  url: string,
): void {
  page.coverage.add("ga4");
  page.url = preferUrl(page.url, url);
  const sessions = optionalNumber(row, "sessions");
  const keyEvents = optionalNumber(row, "keyEvents");
  const engagementRate = optionalNumber(row, "engagementRate");
  if (sessions != null) {
    if (
      page.sessions != null &&
      page.engagementRate != null &&
      engagementRate != null
    ) {
      const total = page.sessions + sessions;
      page.engagementRate =
        total > 0
          ? (page.engagementRate * page.sessions + engagementRate * sessions) /
            total
          : engagementRate;
    } else if (page.engagementRate == null) {
      page.engagementRate = engagementRate;
    }
    page.sessions = (page.sessions ?? 0) + sessions;
  } else if (page.engagementRate == null) {
    page.engagementRate = engagementRate;
  }
  if (keyEvents != null) page.keyEvents = (page.keyEvents ?? 0) + keyEvents;
}

export function addGsc(
  page: DraftPage,
  row: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  },
  url: string,
  queries: TrafficInsightsQuery[],
): void {
  page.coverage.add("gsc");
  page.url = preferUrl(page.url, url);
  const clicks = (page.clicks ?? 0) + row.clicks;
  const impressions = (page.impressions ?? 0) + row.impressions;
  const weighted =
    (page.averagePosition ?? 0) * (page.impressions ?? 0) +
    row.position * row.impressions;
  page.clicks = clicks;
  page.impressions = impressions;
  page.ctr = impressions > 0 ? clicks / impressions : row.ctr;
  page.averagePosition = impressions > 0 ? weighted / impressions : null;
  addQueries(page, queries);
}

function mergeRank(page: DraftPage, rank: DraftPage): void {
  page.coverage.add("rank_tracking");
  page.url = preferUrl(page.url, rank.url);
  for (const [keyword, value] of rank.keywordsByName) {
    const existing = page.keywordsByName.get(keyword);
    if (!existing || value.position < existing.position) {
      page.keywordsByName.set(keyword, value);
    }
  }
}

function takeMatching(
  source: Map<string, DraftPage>,
  consumed: Set<string>,
  key: string,
): DraftPage | undefined {
  const available = [...source.keys()].filter(
    (candidate) => !consumed.has(candidate),
  );
  const match = matchLandingPageKey(available, key);
  if (!match) return undefined;
  consumed.add(match);
  return source.get(match);
}

export function joinSourcePages(
  ga4ByKey: Map<string, DraftPage>,
  gscByKey: Map<string, DraftPage>,
  rankByKey: Map<string, DraftPage>,
): Map<string, DraftPage> {
  const joined = new Map<string, DraftPage>();
  const consumedGsc = new Set<string>();
  const consumedRank = new Set<string>();

  for (const [key, ga4] of ga4ByKey) {
    const page = emptyPage(key, ga4.url);
    page.coverage.add("ga4");
    page.sessions = ga4.sessions;
    page.engagementRate = ga4.engagementRate;
    page.keyEvents = ga4.keyEvents;
    const gsc = takeMatching(gscByKey, consumedGsc, key);
    if (gsc) {
      page.coverage.add("gsc");
      page.url = preferUrl(page.url, gsc.url);
      page.clicks = gsc.clicks;
      page.impressions = gsc.impressions;
      page.ctr = gsc.ctr;
      page.averagePosition = gsc.averagePosition;
      page.queries = gsc.queries;
    }
    const rank = takeMatching(rankByKey, consumedRank, key);
    if (rank) mergeRank(page, rank);
    joined.set(key, page);
  }

  for (const [key, gsc] of gscByKey) {
    if (consumedGsc.has(key)) continue;
    const page = emptyPage(key, gsc.url);
    page.coverage.add("gsc");
    page.clicks = gsc.clicks;
    page.impressions = gsc.impressions;
    page.ctr = gsc.ctr;
    page.averagePosition = gsc.averagePosition;
    page.queries = gsc.queries;
    const rank = takeMatching(rankByKey, consumedRank, key);
    if (rank) mergeRank(page, rank);
    joined.set(key, page);
  }

  for (const [key, rank] of rankByKey) {
    if (consumedRank.has(key)) continue;
    joined.set(key, rank);
  }

  return joined;
}

export function toPage(
  draft: DraftPage,
  rankConfigured: boolean,
): TrafficInsightsPage {
  const trackedKeywords = [...draft.keywordsByName.values()].toSorted(
    (left, right) => left.position - right.position,
  );
  return {
    key: draft.key,
    url: draft.url,
    coverage: [...draft.coverage],
    sessions: draft.sessions,
    engagementRate: draft.engagementRate,
    keyEvents: draft.keyEvents,
    clicks: draft.clicks,
    impressions: draft.impressions,
    ctr: draft.ctr,
    averagePosition: draft.averagePosition,
    queries: draft.queries,
    trackedKeywords: trackedKeywords.slice(0, KEYWORDS_PER_PAGE),
    keywordCount: rankConfigured ? trackedKeywords.length : null,
    bestPosition: rankConfigured
      ? (trackedKeywords[0]?.position ?? null)
      : null,
  };
}
