import { describe, expect, it } from "vitest";
import { discoverCompetitors } from "./rank-tracking-competitors";

describe("discoverCompetitors", () => {
  it("ranks domains by keyword overlap, then average position", () => {
    const rows = discoverCompetitors([
      { trackingKeywordId: "a", domain: "rival.com", position: 2 },
      { trackingKeywordId: "b", domain: "rival.com", position: 8 },
      { trackingKeywordId: "a", domain: "other.com", position: 1 },
      { trackingKeywordId: "a", domain: "rival.com", position: 5 },
    ]);
    expect(rows).toEqual([
      { domain: "rival.com", overlapCount: 2, averagePosition: 5 },
      { domain: "other.com", overlapCount: 1, averagePosition: 1 },
    ]);
  });

  it("ignores rows without a usable organic position", () => {
    expect(
      discoverCompetitors([
        { trackingKeywordId: "a", domain: "rival.com", position: null },
        { trackingKeywordId: "a", domain: "", position: 3 },
      ]),
    ).toEqual([]);
  });
});
