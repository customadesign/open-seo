import { describe, expect, it } from "vitest";
import {
  parseRobotsFile,
  parseSitemapXml,
  validateRobotsTxt,
} from "@/server/lib/audit/site-files";

describe("validateRobotsTxt", () => {
  it("accepts a normal robots file and rejects HTML", () => {
    expect(
      validateRobotsTxt(
        `User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml`,
      ),
    ).toBeNull();
    expect(
      validateRobotsTxt("<!DOCTYPE html><html><body>nope</body></html>"),
    ).toBe("robots.txt looks like HTML");
    expect(validateRobotsTxt("Disallow: /secret")).toBe(
      "disallow appeared before any User-agent",
    );
  });
});

describe("parseRobotsFile", () => {
  it("extracts sitemap directives and disallowed paths", () => {
    const snapshot = parseRobotsFile(
      "https://example.com",
      `User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml\nSitemap: https://example.com/news.xml`,
      200,
    );
    expect(snapshot.found).toBe(true);
    expect(snapshot.hasSitemapDirective).toBe(true);
    expect(snapshot.sitemapUrls).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/news.xml",
    ]);
    expect(snapshot.disallowedPaths).toEqual([
      { userAgent: "*", path: "/private" },
    ]);
  });
});

describe("parseSitemapXml", () => {
  it("counts entries and HTTP URLs on a urlset", () => {
    const parsed = parseSitemapXml(
      `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc>http://example.com/old</loc></url>
      </urlset>`,
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap.xml",
    );
    expect(parsed.parseError).toBeNull();
    expect(parsed.entryCount).toBe(2);
    expect(parsed.httpUrlCount).toBe(1);
    expect(parsed.isIndex).toBe(false);
  });
});
