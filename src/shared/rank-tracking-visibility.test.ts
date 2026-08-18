import { describe, expect, it } from "vitest";
import {
  formatVisibilityContribution,
  visibilityContributions,
  visibilityPercent,
} from "./rank-tracking-visibility";

describe("visibilityContributions", () => {
  it("attributes the overall visibility change to the keywords that moved", () => {
    const rows = [
      {
        trackingKeywordId: "a",
        keyword: "digital marquee san diego",
        searchVolume: 1000,
        position: 8,
        previousPosition: 1,
      },
      {
        trackingKeywordId: "b",
        keyword: "sign shop",
        searchVolume: 1000,
        position: 1,
        previousPosition: 1,
      },
    ];
    const current = visibilityPercent(
      rows.map((row) => ({
        searchVolume: row.searchVolume,
        position: row.position,
      })),
    );
    const previous = visibilityPercent(
      rows.map((row) => ({
        searchVolume: row.searchVolume,
        position: row.previousPosition,
      })),
    );
    const contributions = visibilityContributions(rows);
    const attributed = contributions.reduce(
      (sum, row) => sum + row.contribution,
      0,
    );

    expect(current).not.toBeNull();
    expect(previous).not.toBeNull();
    expect(attributed).toBeCloseTo((current ?? 0) - (previous ?? 0), 8);
    expect(contributions[0].keyword).toBe("digital marquee san diego");
    expect(contributions[0].contribution).toBeLessThan(0);
    expect(
      formatVisibilityContribution(
        contributions[0].keyword,
        contributions[0].contribution,
      ),
    ).toMatch(/^digital marquee san diego −\d+\.\d{2}%$/);
  });

  it("omits keywords that have no search volume", () => {
    expect(
      visibilityContributions([
        {
          trackingKeywordId: "a",
          keyword: "no volume",
          searchVolume: null,
          position: 1,
          previousPosition: 10,
        },
      ]),
    ).toEqual([]);
  });
});
