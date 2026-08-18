import { describe, expect, it } from "vitest";
import {
  RANK_SERP_COMPETITOR_LIMIT,
  captureRankCheckSerp,
} from "./rank-check-serp";

describe("captureRankCheckSerp", () => {
  it("keeps every tracked-domain organic URL, not just the best", () => {
    const capture = captureRankCheckSerp(
      [
        {
          type: "organic",
          rank_group: 4,
          domain: "example.com",
          url: "https://example.com/a",
        },
        {
          type: "organic",
          rank_group: 2,
          domain: "www.example.com",
          url: "https://example.com/b",
        },
        {
          type: "organic",
          rank_group: 7,
          domain: "blog.example.com",
          url: "https://blog.example.com/c",
        },
      ],
      "example.com",
    );
    expect(capture.position).toBe(2);
    expect(capture.url).toBe("https://example.com/b");
    expect(capture.ownedUrls).toEqual([
      { url: "https://example.com/b", position: 2 },
      { url: "https://example.com/a", position: 4 },
      { url: "https://blog.example.com/c", position: 7 },
    ]);
  });

  it("stores the top competitor domains by best organic position", () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      type: "organic" as const,
      rank_group: index + 1,
      domain: `comp${index + 1}.com`,
      url: `https://comp${index + 1}.com/`,
    }));
    items.splice(2, 0, {
      type: "organic",
      rank_group: 3,
      domain: "example.com",
      url: "https://example.com/",
    });
    const capture = captureRankCheckSerp(items, "example.com");
    expect(capture.competitors).toHaveLength(RANK_SERP_COMPETITOR_LIMIT);
    expect(capture.competitors[0]).toEqual({
      domain: "comp1.com",
      position: 1,
    });
    expect(capture.competitors.map((row) => row.domain)).not.toContain(
      "example.com",
    );
  });

  it("marks a SERP feature owned when the tracked domain holds it", () => {
    const capture = captureRankCheckSerp(
      [
        {
          type: "featured_snippet",
          domain: "example.com",
          url: "https://example.com/answer",
        },
        { type: "people_also_ask" },
        {
          type: "organic",
          rank_group: 1,
          domain: "example.com",
          url: "https://example.com/answer",
        },
      ],
      "example.com",
    );
    expect(capture.featureOwnership).toEqual([
      { type: "featured_snippet", owned: true },
      { type: "people_also_ask", owned: false },
    ]);
  });
});
