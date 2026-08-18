import type {
  AiCrawlerAccess,
  LlmsTxtStatus,
} from "@/server/lib/audit/discovery";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_URLS,
} from "@/server/lib/audit/issues/thresholds";
import type { CompactSiteFilesSnapshot } from "@/server/lib/audit/site-files";

export function runSitewideChecks(input: {
  origin: string;
  aiCrawlerAccess: AiCrawlerAccess[];
  llmsTxt: LlmsTxtStatus;
  siteFiles?: CompactSiteFilesSnapshot;
}): DetectedIssue[] {
  const blockedSearch = input.aiCrawlerAccess.filter(
    (crawler) => !crawler.allowed && crawler.kind === "search",
  );
  const blockedAiSearch = input.aiCrawlerAccess.filter(
    (crawler) => !crawler.allowed && crawler.kind === "ai-search",
  );
  const issues: DetectedIssue[] = [];

  if (blockedSearch.length > 0) {
    issues.push({
      issueType: "search-crawler-blocked",
      pageId: null,
      pageUrl: `${input.origin}/robots.txt`,
      details: {
        blocked: blockedSearch.map(({ userAgent, label }) => ({
          userAgent,
          label,
        })),
      },
    });
  }

  if (blockedAiSearch.length > 0) {
    issues.push({
      issueType: "ai-search-crawler-blocked",
      pageId: null,
      pageUrl: `${input.origin}/robots.txt`,
      details: {
        blocked: blockedAiSearch.map(({ userAgent, label }) => ({
          userAgent,
          label,
        })),
      },
    });
  }

  if (!input.llmsTxt.available) {
    issues.push({
      issueType: "missing-llms-txt",
      pageId: null,
      pageUrl: `${input.origin}/llms.txt`,
      details: { statusCode: input.llmsTxt.statusCode },
    });
  }

  if (input.siteFiles) {
    issues.push(...reportSiteFileIssues(input.origin, input.siteFiles));
  }

  return issues;
}

function defaultSitemapUrl(origin: string): string {
  return `${origin}/sitemap.xml`;
}

function reportSiteFileIssues(
  origin: string,
  siteFiles: CompactSiteFilesSnapshot,
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const robotsUrl = `${origin}/robots.txt`;
  const sitemapXmlUrl = defaultSitemapUrl(origin);
  const isHttpsSite = origin.toLowerCase().startsWith("https://");

  if (!siteFiles.robots.found) {
    issues.push({
      issueType: "robots-missing",
      pageId: null,
      pageUrl: robotsUrl,
      details: { statusCode: siteFiles.robots.statusCode },
    });
  } else if (siteFiles.robots.parseError) {
    issues.push({
      issueType: "robots-invalid",
      pageId: null,
      pageUrl: robotsUrl,
      details: { parseError: siteFiles.robots.parseError },
    });
  }

  if (siteFiles.robots.found && !siteFiles.robots.hasSitemapDirective) {
    issues.push({
      issueType: "sitemap-not-in-robots",
      pageId: null,
      pageUrl: robotsUrl,
    });
  }

  const defaultSitemap = siteFiles.sitemaps.find(
    (sitemap) => sitemap.url === sitemapXmlUrl,
  );
  if (!defaultSitemap || !defaultSitemap.found) {
    issues.push({
      issueType: "sitemap-missing",
      pageId: null,
      pageUrl: sitemapXmlUrl,
      details: { statusCode: defaultSitemap?.statusCode ?? null },
    });
  }

  for (const sitemap of siteFiles.sitemaps) {
    if (!sitemap.found) continue;
    if (sitemap.parseError) {
      issues.push({
        issueType: "sitemap-invalid",
        pageId: null,
        pageUrl: sitemap.url,
        dedupeKey: sitemap.url,
        details: { parseError: sitemap.parseError },
      });
    }
    if (
      sitemap.entryCount > SITEMAP_MAX_URLS ||
      sitemap.byteSize > SITEMAP_MAX_BYTES
    ) {
      issues.push({
        issueType: "sitemap-too-large",
        pageId: null,
        pageUrl: sitemap.url,
        dedupeKey: sitemap.url,
        details: {
          entryCount: sitemap.entryCount,
          byteSize: sitemap.byteSize,
        },
      });
    }
    if (isHttpsSite && sitemap.httpUrlCount > 0) {
      issues.push({
        issueType: "sitemap-http-urls-on-https-site",
        pageId: null,
        pageUrl: sitemap.url,
        dedupeKey: sitemap.url,
        details: { httpUrlCount: sitemap.httpUrlCount },
      });
    }
  }

  return issues;
}
