import { groupTopQueriesByPage } from "@/server/features/gsc/searchPerformanceReport";
import {
  resolveDateRange,
  type GscDateRange,
} from "@/server/features/gsc/searchAnalytics";
import { normalizeLandingPageKey } from "@/server/features/traffic-insights/normalizeLandingPageKey";
import {
  loadGa4Source,
  loadGscSource,
  loadRankTrackingSource,
} from "./trafficInsightsSources";

const QUERIES_PER_PAGE = 15;
const KEYWORDS_PER_PAGE = 15;

export type TrafficInsightsDateRange = Extract<
  GscDateRange,
  "last_7_days" | "last_28_days" | "last_3_months"
>;

export type TrafficInsightsInput = {
  projectId: string;
  dateRange?: TrafficInsightsDateRange;
  startDate?: string;
  endDate?: string;
};

export type TrafficInsightsQuery = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type TrafficInsightsKeyword = {
  keyword: string;
  position: number;
  device: "desktop" | "mobile";
};

export type TrafficInsightsSourceStatus =
  | { status: "connected" }
  | { status: "not_connected" }
  | { status: "not_configured" }
  | { status: "error"; code: string; message: string };

export type TrafficInsightsPage = {
  key: string;
  url: string;
  coverage: Array<"ga4" | "gsc" | "rank_tracking">;
  sessions: number | null;
  engagementRate: number | null;
  keyEvents: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
  queries: TrafficInsightsQuery[];
  trackedKeywords: TrafficInsightsKeyword[];
  keywordCount: number | null;
  bestPosition: number | null;
};

export type TrafficInsightsResult = {
  range: { startDate: string; endDate: string };
  sources: {
    ga4: TrafficInsightsSourceStatus & {
      propertyId?: string;
      propertyName?: string;
      warnings: string[];
      hasLimitedData: boolean;
    };
    gsc: TrafficInsightsSourceStatus & { siteUrl?: string };
    rankTracking: TrafficInsightsSourceStatus;
  };
  rows: TrafficInsightsPage[];
  truncated: { ga4: boolean; gsc: boolean; gscQueries: boolean };
};

type DraftPage = {
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

function optionalNumber(
  row: Record<string, string | number | null>,
  name: string,
): number | null {
  const value = row[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getOrCreatePage(
  pages: Map<string, DraftPage>,
  key: string,
  url: string,
): DraftPage {
  const existing = pages.get(key);
  if (existing) {
    if (url.startsWith("http") && !existing.url.startsWith("http")) {
      existing.url = url;
    }
    return existing;
  }
  const created: DraftPage = {
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
  pages.set(key, created);
  return created;
}

function displayUrl(page: string, host?: string): string {
  if (page.includes("://")) return page;
  if (host) {
    const path = page.startsWith("/") ? page : `/${page}`;
    return `https://${host}${path}`;
  }
  return page;
}

function toPage(
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

function ga4Source(
  ga4: Awaited<ReturnType<typeof loadGa4Source>>,
): TrafficInsightsResult["sources"]["ga4"] {
  if (ga4.status === "error") {
    return {
      status: "error",
      code: ga4.code,
      message: ga4.message,
      warnings: ga4.warnings,
      hasLimitedData: ga4.hasLimitedData,
    };
  }
  if (ga4.status === "connected") {
    return {
      status: "connected",
      propertyId: ga4.propertyId,
      propertyName: ga4.propertyName,
      warnings: ga4.warnings,
      hasLimitedData: ga4.hasLimitedData,
    };
  }
  return {
    status: "not_connected",
    warnings: ga4.warnings,
    hasLimitedData: ga4.hasLimitedData,
  };
}

function gscSource(
  gsc: Awaited<ReturnType<typeof loadGscSource>>,
): TrafficInsightsResult["sources"]["gsc"] {
  if (gsc.status === "error") {
    return { status: "error", code: gsc.code, message: gsc.message };
  }
  if (gsc.status === "connected") {
    return { status: "connected", siteUrl: gsc.siteUrl };
  }
  return { status: "not_connected" };
}

function comparePages(left: TrafficInsightsPage, right: TrafficInsightsPage) {
  const sessionDelta = (right.sessions ?? -1) - (left.sessions ?? -1);
  if (sessionDelta !== 0) return sessionDelta;
  const clickDelta = (right.clicks ?? -1) - (left.clicks ?? -1);
  if (clickDelta !== 0) return clickDelta;
  return left.url.localeCompare(right.url);
}

async function getInsights(
  input: TrafficInsightsInput,
): Promise<TrafficInsightsResult> {
  const range = resolveDateRange({
    dateRange: input.dateRange ?? "last_28_days",
    startDate: input.startDate,
    endDate: input.endDate,
  });
  const [ga4, gsc, rankTracking] = await Promise.all([
    loadGa4Source({ projectId: input.projectId, ...range }),
    loadGscSource({ projectId: input.projectId, ...range }),
    loadRankTrackingSource(input.projectId),
  ]);

  const pages = new Map<string, DraftPage>();

  for (const row of ga4.rows) {
    const host = typeof row.hostName === "string" ? row.hostName : "";
    const landing = typeof row.landingPage === "string" ? row.landingPage : "";
    const key = normalizeLandingPageKey(landing, host);
    if (!key) continue;
    const page = getOrCreatePage(pages, key, displayUrl(landing, host));
    page.coverage.add("ga4");
    page.sessions = optionalNumber(row, "sessions");
    page.engagementRate = optionalNumber(row, "engagementRate");
    page.keyEvents = optionalNumber(row, "keyEvents");
  }

  const queriesByPage = groupTopQueriesByPage(gsc.queryRows, QUERIES_PER_PAGE);
  for (const row of gsc.rows) {
    const url = row.keys?.[0] ?? "";
    const key = normalizeLandingPageKey(url);
    if (!key) continue;
    const page = getOrCreatePage(pages, key, url);
    page.coverage.add("gsc");
    page.clicks = row.clicks;
    page.impressions = row.impressions;
    page.ctr = row.ctr;
    page.averagePosition = row.position;
    page.queries = queriesByPage.get(url) ?? [];
  }

  for (const snapshot of rankTracking.snapshots) {
    if (!snapshot.url || snapshot.position == null) continue;
    const key = normalizeLandingPageKey(snapshot.url);
    if (!key) continue;
    const page = getOrCreatePage(pages, key, snapshot.url);
    page.coverage.add("rank_tracking");
    const existing = page.keywordsByName.get(snapshot.keyword);
    if (!existing || snapshot.position < existing.position) {
      page.keywordsByName.set(snapshot.keyword, {
        keyword: snapshot.keyword,
        position: snapshot.position,
        device: snapshot.device,
      });
    }
  }

  const rows = [...pages.values()]
    .map((draft) => toPage(draft, rankTracking.status === "configured"))
    .toSorted(comparePages);
  return {
    range,
    sources: {
      ga4: ga4Source(ga4),
      gsc: gscSource(gsc),
      rankTracking:
        rankTracking.status === "configured"
          ? { status: "connected" }
          : { status: "not_configured" },
    },
    rows,
    truncated: {
      ga4: ga4.truncated,
      gsc: gsc.truncated,
      gscQueries: gsc.queriesTruncated,
    },
  };
}

export const OrganicTrafficInsightsService = { getInsights };
