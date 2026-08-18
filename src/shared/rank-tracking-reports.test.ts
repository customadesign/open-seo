import { describe, expect, it } from "vitest";
import { estimatedTraffic } from "./rank-tracking-visibility";
import {
  countRankBands,
  groupSnapshotsByPage,
  rankBand,
  rankBandMovement,
  serpFeatureChanges,
} from "./rank-tracking-reports";

describe("rankBand", () => {
  it("puts a stored position in the matching disjoint band", () => {
    expect(rankBand(1)).toBe("top3");
    expect(rankBand(4)).toBe("top4to10");
    expect(rankBand(11)).toBe("top11to20");
    expect(rankBand(21)).toBe("top21to100");
    expect(rankBand(100)).toBe("top21to100");
    expect(rankBand(null)).toBe("notInTop100");
    expect(rankBand(101)).toBe("notInTop100");
  });
});

describe("rankBandMovement", () => {
  it("counts keywords that entered or left each band between two snapshots", () => {
    const movement = rankBandMovement(
      [
        { id: "a", position: 2 },
        { id: "b", position: 12 },
        { id: "c", position: null },
      ],
      [
        { id: "a", position: 8 },
        { id: "b", position: 12 },
        { id: "c", position: 3 },
      ],
    );
    expect(movement.top3).toEqual({ entered: 1, left: 1 });
    expect(movement.top4to10).toEqual({ entered: 0, left: 1 });
    expect(movement.top11to20).toEqual({ entered: 0, left: 0 });
    expect(movement.notInTop100).toEqual({ entered: 1, left: 0 });
  });
});

describe("countRankBands", () => {
  it("covers every keyword exactly once", () => {
    expect(countRankBands([1, 4, 15, 40, null])).toEqual({
      top3: 1,
      top4to10: 1,
      top11to20: 1,
      top21to100: 1,
      notInTop100: 1,
    });
  });
});

describe("groupSnapshotsByPage", () => {
  it("groups ranking keywords by normalized URL and reports change", () => {
    const pages = groupSnapshotsByPage(
      [
        {
          trackingKeywordId: "a",
          url: "https://example.com/signs/",
          position: 2,
          searchVolume: 1000,
        },
        {
          trackingKeywordId: "b",
          url: "https://www.example.com/signs",
          position: 8,
          searchVolume: 100,
        },
      ],
      [
        {
          trackingKeywordId: "a",
          url: "https://example.com/signs",
          position: 4,
          searchVolume: 1000,
        },
      ],
      estimatedTraffic,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].keywordCount).toBe(2);
    expect(pages[0].previousKeywordCount).toBe(1);
    expect(pages[0].keywordCountChange).toBe(1);
    expect(pages[0].bestPosition).toBe(2);
  });
});

describe("serpFeatureChanges", () => {
  it("ignores organic and reports features gained or lost since last snapshot", () => {
    const rows = serpFeatureChanges(
      [
        {
          trackingKeywordId: "a",
          keyword: "sign shop",
          position: 1,
          features: ["organic", "featured_snippet", "people_also_ask"],
        },
      ],
      new Map([["a", ["organic", "people_also_ask", "local_pack"]]]),
    );
    expect(rows).toEqual([
      {
        trackingKeywordId: "a",
        keyword: "sign shop",
        position: 1,
        features: ["featured_snippet", "people_also_ask"],
        previousFeatures: ["people_also_ask", "local_pack"],
        gained: ["featured_snippet"],
        lost: ["local_pack"],
      },
    ]);
  });
});
