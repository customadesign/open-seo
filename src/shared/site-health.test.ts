import { describe, expect, it } from "vitest";
import { computeSiteHealthScore } from "./site-health";

describe("computeSiteHealthScore", () => {
  it("scores against the per-page cap and ignores info issues", () => {
    // 2 pages ⇒ worst case 20 penalty points.
    // page-a: 1 critical (5) + 1 warning (2) = 7; page-b: info only = 0.
    expect(
      computeSiteHealthScore({
        pagesCrawled: 2,
        pageSeverityCounts: [
          { pageUrl: "/a", severity: "critical", issues: 1 },
          { pageUrl: "/a", severity: "warning", issues: 1 },
          { pageUrl: "/b", severity: "info", issues: 9 },
        ],
      }),
    ).toBe(65);
  });

  it("caps one catastrophic page so it cannot sink the whole score", () => {
    // 20 criticals on one page would be 100 penalty points uncapped; the cap
    // holds it to 10 of the 30-point worst case across 3 pages.
    expect(
      computeSiteHealthScore({
        pagesCrawled: 3,
        pageSeverityCounts: [
          { pageUrl: "/a", severity: "critical", issues: 20 },
        ],
      }),
    ).toBe(67);
  });

  it("returns null when nothing was crawled rather than a zero score", () => {
    expect(
      computeSiteHealthScore({ pagesCrawled: 0, pageSeverityCounts: [] }),
    ).toBeNull();
  });

  it("scores a clean crawl as 100", () => {
    expect(
      computeSiteHealthScore({ pagesCrawled: 5, pageSeverityCounts: [] }),
    ).toBe(100);
  });
});
