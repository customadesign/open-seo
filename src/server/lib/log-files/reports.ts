import {
  LOG_FILE_BOT_LABELS,
  MAX_ERROR_PATHS,
  MAX_REPORT_PATHS,
  type LogFileBotId,
} from "@/shared/log-files";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import type { BotSummaryAggregate, PathDailyAggregate } from "./aggregate";

export type AuditPageJoin = {
  url: string;
  crawlDepth: number | null;
  inSitemap: boolean;
};

export type CrawlBudgetDay = {
  botId: LogFileBotId;
  label: string;
  day: string;
  requests: number;
  verifiedRequests: number;
};

export type PathCount = {
  path: string;
  requests: number;
  verifiedRequests: number;
};

export type StatusDistribution = {
  botId: LogFileBotId;
  label: string;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
};

export type ErrorPath = {
  botId: LogFileBotId;
  label: string;
  path: string;
  status4xx: number;
  status5xx: number;
};

export type DepthBucket = {
  depth: number | "unknown";
  requests: number;
  paths: number;
};

export type SitemapBucket = {
  inSitemap: boolean | "unknown";
  requests: number;
  paths: number;
};

export type BotResponseTime = {
  botId: LogFileBotId;
  label: string;
  averageMs: number | null;
  samples: number;
};

export type LogFileReports = {
  crawlBudget: CrawlBudgetDay[];
  mostCrawled: PathCount[];
  neverCrawled: string[];
  statusDistribution: StatusDistribution[];
  errorPaths: ErrorPath[];
  frequencyByDepth: DepthBucket[];
  frequencyBySitemap: SitemapBucket[];
  responseTimes: BotResponseTime[];
  orphans: PathCount[];
};

function auditPath(url: string, origin: string): string | null {
  const normalized = normalizeUrl(url, origin);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function label(botId: LogFileBotId) {
  return LOG_FILE_BOT_LABELS[botId];
}

export function buildLogFileReports(input: {
  pathDaily: PathDailyAggregate[];
  bots: BotSummaryAggregate[];
  auditPages: AuditPageJoin[];
  projectDomain: string | null;
}): LogFileReports {
  const origin = input.projectDomain
    ? `https://${input.projectDomain.replace(/^https?:\/\//, "")}`
    : "https://example.invalid";

  const auditPaths = new Map<
    string,
    { crawlDepth: number | null; inSitemap: boolean }
  >();
  for (const page of input.auditPages) {
    const path = auditPath(page.url, origin);
    if (!path) continue;
    auditPaths.set(path, {
      crawlDepth: page.crawlDepth,
      inSitemap: page.inSitemap,
    });
  }

  const crawlBudgetMap = new Map<string, CrawlBudgetDay>();
  const pathTotals = new Map<string, PathCount>();
  const statusMap = new Map<LogFileBotId, StatusDistribution>();
  const errorMap = new Map<string, ErrorPath>();
  const depthMap = new Map<string, DepthBucket>();
  const sitemapMap = new Map<string, SitemapBucket>();
  const timeMap = new Map<LogFileBotId, { sum: number; samples: number }>();

  for (const row of input.pathDaily) {
    const budgetKey = `${row.botId}|${row.day}`;
    const budget =
      crawlBudgetMap.get(budgetKey) ??
      ({
        botId: row.botId,
        label: label(row.botId),
        day: row.day,
        requests: 0,
        verifiedRequests: 0,
      } satisfies CrawlBudgetDay);
    budget.requests += row.requests;
    budget.verifiedRequests += row.verifiedRequests;
    crawlBudgetMap.set(budgetKey, budget);

    const path = pathTotals.get(row.path) ?? {
      path: row.path,
      requests: 0,
      verifiedRequests: 0,
    };
    path.requests += row.requests;
    path.verifiedRequests += row.verifiedRequests;
    pathTotals.set(row.path, path);

    const status =
      statusMap.get(row.botId) ??
      ({
        botId: row.botId,
        label: label(row.botId),
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
      } satisfies StatusDistribution);
    status.status2xx += row.status2xx;
    status.status3xx += row.status3xx;
    status.status4xx += row.status4xx;
    status.status5xx += row.status5xx;
    statusMap.set(row.botId, status);

    if (row.status4xx > 0 || row.status5xx > 0) {
      const errorKey = `${row.botId}|${row.path}`;
      const error = errorMap.get(errorKey) ?? {
        botId: row.botId,
        label: label(row.botId),
        path: row.path,
        status4xx: 0,
        status5xx: 0,
      };
      error.status4xx += row.status4xx;
      error.status5xx += row.status5xx;
      errorMap.set(errorKey, error);
    }

    const audit = auditPaths.get(row.path);
    const depthKey =
      audit?.crawlDepth == null ? "unknown" : String(audit.crawlDepth);
    const depth = depthMap.get(depthKey) ?? {
      depth: audit?.crawlDepth == null ? "unknown" : audit.crawlDepth,
      requests: 0,
      paths: 0,
    };
    depth.requests += row.requests;
    depth.paths += 1;
    depthMap.set(depthKey, depth);

    const sitemapKey =
      audit == null ? "unknown" : audit.inSitemap ? "yes" : "no";
    const sitemap = sitemapMap.get(sitemapKey) ?? {
      inSitemap: audit == null ? "unknown" : audit.inSitemap,
      requests: 0,
      paths: 0,
    };
    sitemap.requests += row.requests;
    sitemap.paths += 1;
    sitemapMap.set(sitemapKey, sitemap);

    const time = timeMap.get(row.botId) ?? { sum: 0, samples: 0 };
    time.sum += row.responseTimeMsSum;
    time.samples += row.responseTimeSamples;
    timeMap.set(row.botId, time);
  }

  const crawledPaths = new Set(pathTotals.keys());
  const neverCrawled = [...auditPaths.keys()]
    .filter((path) => !crawledPaths.has(path))
    .toSorted()
    .slice(0, MAX_REPORT_PATHS);

  const orphans = [...pathTotals.values()]
    .filter((row) => !auditPaths.has(row.path))
    .toSorted((a, b) => b.requests - a.requests)
    .slice(0, MAX_REPORT_PATHS);

  return {
    crawlBudget: [...crawlBudgetMap.values()].toSorted((a, b) =>
      a.day === b.day
        ? a.botId.localeCompare(b.botId)
        : a.day.localeCompare(b.day),
    ),
    mostCrawled: [...pathTotals.values()]
      .toSorted((a, b) => b.requests - a.requests)
      .slice(0, MAX_REPORT_PATHS),
    neverCrawled,
    statusDistribution: [...statusMap.values()].toSorted((a, b) =>
      a.botId.localeCompare(b.botId),
    ),
    errorPaths: [...errorMap.values()]
      .toSorted(
        (a, b) => b.status4xx + b.status5xx - (a.status4xx + a.status5xx),
      )
      .slice(0, MAX_ERROR_PATHS),
    frequencyByDepth: [...depthMap.values()].toSorted((a, b) => {
      if (a.depth === "unknown") return 1;
      if (b.depth === "unknown") return -1;
      return a.depth - b.depth;
    }),
    frequencyBySitemap: [...sitemapMap.values()],
    responseTimes: input.bots.map((bot) => {
      const time = timeMap.get(bot.botId);
      return {
        botId: bot.botId,
        label: label(bot.botId),
        averageMs:
          time && time.samples > 0 ? Math.round(time.sum / time.samples) : null,
        samples: time?.samples ?? 0,
      };
    }),
    orphans,
  };
}
