import { describe, expect, it } from "vitest";
import {
  detectKeywordCannibalization,
  detectSameSerpCannibalization,
  type CannibalizationSnapshot,
} from "./rank-tracking-cannibalization";

function snap(
  checkedAt: string,
  url: string | null,
  position: number | null,
): CannibalizationSnapshot {
  return { checkedAt, url, position };
}

function finding(snapshots: CannibalizationSnapshot[]) {
  return detectKeywordCannibalization({
    trackingKeywordId: "kw_1",
    keyword: "sign shop",
    device: "desktop",
    snapshots,
  });
}

describe("detectKeywordCannibalization", () => {
  it("does not report a single one-way URL change after a redirect", () => {
    expect(
      finding([
        snap("2026-01-01", "https://example.com/old", 4),
        snap("2026-01-08", "https://example.com/old", 4),
        snap("2026-01-15", "https://example.com/new", 3),
        snap("2026-01-22", "https://example.com/new", 3),
      ]),
    ).toBeNull();
  });

  it("reports a keyword that oscillates between two ranking URLs", () => {
    const result = finding([
      snap("2026-01-01", "https://example.com/a", 2),
      snap("2026-01-08", "https://example.com/b", 3),
      snap("2026-01-15", "https://example.com/a", 2),
    ]);
    expect(result).toMatchObject({
      keyword: "sign shop",
      transitionCount: 2,
      currentUrl: "https://example.com/a",
      currentPosition: 2,
    });
    expect(result?.competingUrls).toEqual([
      { url: "https://example.com/a", snapshotCount: 2 },
      { url: "https://example.com/b", snapshotCount: 1 },
    ]);
  });

  it("treats protocol, www, trailing slash, and query as the same URL", () => {
    expect(
      finding([
        snap("2026-01-01", "http://www.example.com/page/", 5),
        snap("2026-01-08", "https://example.com/page?utm=1", 4),
        snap("2026-01-15", "https://example.com/page#top", 4),
      ]),
    ).toBeNull();
  });

  it("ignores unranked gaps so a later URL change is still one transition", () => {
    expect(
      finding([
        snap("2026-01-01", "https://example.com/a", 6),
        snap("2026-01-08", null, null),
        snap("2026-01-15", "https://example.com/b", 8),
      ]),
    ).toBeNull();
  });

  it("flags two tracked URLs on one SERP", () => {
    const result = detectSameSerpCannibalization({
      trackingKeywordId: "kw_1",
      keyword: "sign shop",
      device: "desktop",
      urls: [
        { url: "https://example.com/a", position: 3 },
        { url: "https://example.com/b", position: 8 },
      ],
    });
    expect(result?.urls).toHaveLength(2);
    expect(result?.currentPosition).toBe(3);
  });

  it("does not flag one URL with query-string variants as same-SERP cannibalization", () => {
    expect(
      detectSameSerpCannibalization({
        trackingKeywordId: "kw_1",
        keyword: "sign shop",
        device: "desktop",
        urls: [
          { url: "https://example.com/a", position: 3 },
          { url: "https://www.example.com/a?utm=1", position: 9 },
        ],
      }),
    ).toBeNull();
  });

  it("reports two sequential replacements as cannibalization", () => {
    const result = finding([
      snap("2026-01-01", "https://example.com/a", 2),
      snap("2026-01-08", "https://example.com/b", 3),
      snap("2026-01-15", "https://example.com/c", 4),
    ]);
    expect(result?.transitionCount).toBe(2);
    expect(result?.competingUrls).toHaveLength(3);
  });
});
