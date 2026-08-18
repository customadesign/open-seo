/**
 * robots.txt and sitemap.xml discovery for the site audit crawler.
 */
import robotsParser from "robots-parser";
import { fetchAuditDiscoveryResource } from "./discovery-fetch";
import { fetchSiteFiles, type SiteFilesSnapshot } from "./site-files";
import { isSameOrigin } from "./url-utils";

export { fetchAuditDiscoveryResource } from "./discovery-fetch";

export interface RobotsResult {
  isAllowed: (url: string) => boolean;
  sitemapUrls: string[];
}

export interface AiCrawlerAccess {
  userAgent: string;
  label: string;
  kind: "search" | "ai-search";
  allowed: boolean;
}

export interface LlmsTxtStatus {
  available: boolean;
  statusCode: number | null;
}

const SEARCH_AND_RETRIEVAL_CRAWLERS = [
  {
    userAgent: "OAI-SearchBot",
    label: "OpenAI search discovery",
    kind: "ai-search",
  },
  {
    userAgent: "ChatGPT-User",
    label: "ChatGPT user-requested retrieval",
    kind: "ai-search",
  },
  {
    userAgent: "PerplexityBot",
    label: "Perplexity search discovery",
    kind: "ai-search",
  },
  {
    userAgent: "Claude-SearchBot",
    label: "Claude search discovery",
    kind: "ai-search",
  },
  {
    userAgent: "Googlebot",
    label: "Google Search and AI Overviews",
    kind: "search",
  },
  {
    userAgent: "bingbot",
    label: "Bing Search and Copilot",
    kind: "search",
  },
] as const;

/** Training-only crawlers are intentionally excluded: blocking training is a
 * separate policy choice and must not be scored as an AI-search failure. */
export function analyzeAiCrawlerAccess(
  origin: string,
  text: string | null,
): AiCrawlerAccess[] {
  if (text === null) {
    return SEARCH_AND_RETRIEVAL_CRAWLERS.map((crawler) => ({
      ...crawler,
      allowed: true,
    }));
  }
  const robots = robotsParser(`${origin}/robots.txt`, text);
  return SEARCH_AND_RETRIEVAL_CRAWLERS.map((crawler) => ({
    ...crawler,
    allowed: robots.isAllowed(`${origin}/`, crawler.userAgent) ?? true,
  }));
}

async function fetchLlmsTxtStatus(origin: string): Promise<LlmsTxtStatus> {
  try {
    const { response } = await fetchAuditDiscoveryResource(
      `${origin}/llms.txt`,
      {
        headers: { "User-Agent": "OpenSEO-Audit/1.0" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const contentType = response.headers.get("content-type")?.toLowerCase();
    return {
      available:
        response.ok &&
        (contentType?.includes("text/plain") === true ||
          contentType?.includes("text/markdown") === true),
      statusCode: response.status,
    };
  } catch {
    return { available: false, statusCode: null };
  }
}

/** Deterministic: same text in, same result out. Null = everything allowed. */
export function parseRobotsTxt(
  origin: string,
  text: string | null,
): RobotsResult {
  if (text === null) {
    return { isAllowed: () => true, sitemapUrls: [] };
  }

  const robots = robotsParser(`${origin}/robots.txt`, text);
  return {
    isAllowed: (url: string) => robots.isAllowed(url) ?? true,
    sitemapUrls: robots.getSitemaps(),
  };
}

/**
 * Discover all page URLs from robots.txt + sitemaps for an origin.
 * Also tries the default /sitemap.xml if not listed in robots.txt.
 */
export async function discoverUrls(
  origin: string,
  maxPages = 50,
): Promise<{
  urls: string[];
  robotsText: string | null;
  aiCrawlerAccess: AiCrawlerAccess[];
  llmsTxt: LlmsTxtStatus;
  siteFiles: SiteFilesSnapshot;
}> {
  const [siteFiles, llmsTxt] = await Promise.all([
    fetchSiteFiles(origin),
    fetchLlmsTxtStatus(origin),
  ]);
  const robotsText = siteFiles.robots.text;
  const maxDiscoveredUrls = Math.min(Math.max(maxPages * 20, 500), 50_000);
  const allUrls = new Set<string>();

  let failedDocs = 0;
  let timedOutDocs = 0;
  for (const sitemap of siteFiles.sitemaps) {
    if (
      sitemap.pageUrls.length === 0 &&
      sitemap.nestedSitemapUrls.length === 0
    ) {
      failedDocs += 1;
      if (sitemap.timedOut) timedOutDocs += 1;
      continue;
    }
    for (const pageUrl of sitemap.pageUrls) {
      if (!isSameOrigin(pageUrl, origin)) continue;
      if (allUrls.size >= maxDiscoveredUrls) break;
      allUrls.add(pageUrl);
    }
  }

  if (failedDocs > 0) {
    console.warn(
      `Sitemap discovery completed with partial failures for ${origin}: fetched=${siteFiles.sitemaps.length}, failed=${failedDocs}, timedOut=${timedOutDocs}, discoveredUrls=${allUrls.size}`,
    );
  }

  // Cap at the crawl's page budget: these are seeds, the crawl can never use
  // more — and an uncapped list can blow the ~1MiB Workflow step-state limit.
  return {
    urls: Array.from(allUrls).slice(0, maxPages),
    robotsText,
    aiCrawlerAccess: analyzeAiCrawlerAccess(origin, robotsText),
    llmsTxt,
    siteFiles,
  };
}
