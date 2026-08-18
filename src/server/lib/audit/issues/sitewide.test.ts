import { describe, expect, it } from "vitest";
import { runSitewideChecks } from "@/server/lib/audit/issues/sitewide";

describe("runSitewideChecks", () => {
  it("separates blocked search and AI retrieval crawlers from optional llms.txt", () => {
    const issues = runSitewideChecks({
      origin: "https://example.com",
      aiCrawlerAccess: [
        {
          userAgent: "OAI-SearchBot",
          label: "OpenAI search",
          kind: "ai-search",
          allowed: false,
        },
        {
          userAgent: "Googlebot",
          label: "Google Search",
          kind: "search",
          allowed: false,
        },
      ],
      llmsTxt: { available: false, statusCode: 404 },
    });

    expect(issues).toMatchObject([
      {
        issueType: "search-crawler-blocked",
        pageUrl: "https://example.com/robots.txt",
        details: {
          blocked: [{ userAgent: "Googlebot", label: "Google Search" }],
        },
      },
      {
        issueType: "ai-search-crawler-blocked",
        pageUrl: "https://example.com/robots.txt",
        details: {
          blocked: [{ userAgent: "OAI-SearchBot", label: "OpenAI search" }],
        },
      },
      {
        issueType: "missing-llms-txt",
        pageUrl: "https://example.com/llms.txt",
        details: { statusCode: 404 },
      },
    ]);
  });

  it("returns no issues when search crawlers and llms.txt are available", () => {
    expect(
      runSitewideChecks({
        origin: "https://example.com",
        aiCrawlerAccess: [
          {
            userAgent: "OAI-SearchBot",
            label: "OpenAI search",
            kind: "ai-search",
            allowed: true,
          },
        ],
        llmsTxt: { available: true, statusCode: 200 },
      }),
    ).toEqual([]);
  });

  it("flags robots and sitemap snapshot problems", () => {
    const issues = runSitewideChecks({
      origin: "https://example.com",
      aiCrawlerAccess: [],
      llmsTxt: { available: true, statusCode: 200 },
      siteFiles: {
        robots: {
          found: true,
          statusCode: 200,
          parseError: "robots.txt looks like HTML",
          hasSitemapDirective: false,
          sitemapUrls: [],
          disallowedPaths: [],
        },
        sitemaps: [
          {
            url: "https://example.com/sitemap.xml",
            found: true,
            statusCode: 200,
            parseError: "not valid sitemap XML",
            entryCount: 60_000,
            byteSize: 51 * 1024 * 1024,
            httpUrlCount: 3,
            isIndex: false,
          },
        ],
      },
    });

    expect(issues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining([
        "robots-invalid",
        "sitemap-not-in-robots",
        "sitemap-invalid",
        "sitemap-too-large",
        "sitemap-http-urls-on-https-site",
      ]),
    );
    expect(issues.map((issue) => issue.issueType)).not.toContain(
      "robots-missing",
    );
    expect(issues.map((issue) => issue.issueType)).not.toContain(
      "sitemap-missing",
    );
  });

  it("flags a missing robots.txt and default sitemap", () => {
    const issues = runSitewideChecks({
      origin: "https://example.com",
      aiCrawlerAccess: [],
      llmsTxt: { available: true, statusCode: 200 },
      siteFiles: {
        robots: {
          found: false,
          statusCode: 404,
          parseError: null,
          hasSitemapDirective: false,
          sitemapUrls: [],
          disallowedPaths: [],
        },
        sitemaps: [
          {
            url: "https://example.com/sitemap.xml",
            found: false,
            statusCode: 404,
            parseError: null,
            entryCount: 0,
            byteSize: 0,
            httpUrlCount: 0,
            isIndex: false,
          },
        ],
      },
    });

    expect(issues.map((issue) => issue.issueType)).toEqual([
      "robots-missing",
      "sitemap-missing",
    ]);
  });
});
