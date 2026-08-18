import { describe, expect, it } from "vitest";
import { buildLogFileReports } from "./reports";

const googlePath = {
  botId: "googlebot" as const,
  day: "2024-10-10",
  path: "/blog",
  requests: 4,
  verifiedRequests: 4,
  bytesTotal: 400,
  responseTimeMsSum: 400,
  responseTimeSamples: 4,
  status2xx: 3,
  status3xx: 0,
  status4xx: 1,
  status5xx: 0,
};

describe("buildLogFileReports", () => {
  it("joins crawled paths to the latest audit for never-crawled and orphans", () => {
    const reports = buildLogFileReports({
      pathDaily: [
        googlePath,
        { ...googlePath, path: "/secret", requests: 2, verifiedRequests: 2 },
      ],
      bots: [
        {
          botId: "googlebot",
          requests: 6,
          verifiedRequests: 6,
          unverifiedRequests: 0,
          uniqueIpsClaimed: 1,
        },
      ],
      auditPages: [
        {
          url: "https://example.com/blog",
          crawlDepth: 1,
          inSitemap: true,
        },
        {
          url: "https://example.com/pricing",
          crawlDepth: 1,
          inSitemap: true,
        },
      ],
      projectDomain: "example.com",
    });

    expect(reports.neverCrawled).toEqual(["/pricing"]);
    expect(reports.orphans.map((row) => row.path)).toEqual(["/secret"]);
    expect(reports.crawlBudget[0]).toMatchObject({
      botId: "googlebot",
      day: "2024-10-10",
      requests: 6,
    });
    expect(reports.errorPaths[0]).toMatchObject({
      path: "/blog",
      status4xx: 1,
    });
  });
});
