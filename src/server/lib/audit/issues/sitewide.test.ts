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
});
