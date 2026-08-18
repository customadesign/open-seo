import { groupTopQueriesByPage } from "@/server/features/gsc/searchPerformanceReport";
import {
  resolveDateRange,
  type GscDateRange,
} from "@/server/features/gsc/searchAnalytics";
import { landingPageKey } from "@/server/lib/landingPageKey";
import {
  addGa4,
  addGsc,
  displayUrl,
  emptyPage,
  joinSourcePages,
  preferUrl,
  QUERIES_PER_PAGE,
  toPage,
  type DraftPage,
} from "./trafficInsightsJoin";
import {
  loadGa4Source,
  loadGscSource,
  loadRankTrackingSource,
} from "./trafficInsightsSources";

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

  const ga4ByKey = new Map<string, DraftPage>();
  const gscByKey = new Map<string, DraftPage>();
  const rankByKey = new Map<string, DraftPage>();
  const queriesByPage = groupTopQueriesByPage(gsc.queryRows, QUERIES_PER_PAGE);

  for (const row of ga4.rows) {
    const host = typeof row.hostName === "string" ? row.hostName : "";
    const landing = typeof row.landingPage === "string" ? row.landingPage : "";
    const key = landingPageKey(landing, host);
    if (!key) continue;
    const page = ga4ByKey.get(key) ?? emptyPage(key, displayUrl(landing, host));
    addGa4(page, row, displayUrl(landing, host));
    ga4ByKey.set(key, page);
  }

  for (const row of gsc.rows) {
    const url = row.keys?.[0] ?? "";
    const key = landingPageKey(url);
    if (!key) continue;
    const page = gscByKey.get(key) ?? emptyPage(key, url);
    addGsc(page, row, url, queriesByPage.get(url) ?? []);
    gscByKey.set(key, page);
  }

  for (const snapshot of rankTracking.snapshots) {
    if (!snapshot.url || snapshot.position == null) continue;
    const key = landingPageKey(snapshot.url);
    if (!key) continue;
    const page = rankByKey.get(key) ?? emptyPage(key, snapshot.url);
    page.coverage.add("rank_tracking");
    page.url = preferUrl(page.url, snapshot.url);
    const existing = page.keywordsByName.get(snapshot.keyword);
    if (!existing || snapshot.position < existing.position) {
      page.keywordsByName.set(snapshot.keyword, {
        keyword: snapshot.keyword,
        position: snapshot.position,
        device: snapshot.device,
      });
    }
    rankByKey.set(key, page);
  }

  const rows = [...joinSourcePages(ga4ByKey, gscByKey, rankByKey).values()]
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
