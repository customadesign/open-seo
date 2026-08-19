import { describe, expect, it } from "vitest";
import { detectSnippetOwnership } from "./rank-tracking-snippets";

describe("detectSnippetOwnership", () => {
  it("labels current ownership as owned, available, or lost", () => {
    const rows = detectSnippetOwnership(
      [
        {
          trackingKeywordId: "a",
          keyword: "sign shop",
          position: 1,
          feature: "featured_snippet",
          owned: true,
        },
        {
          trackingKeywordId: "b",
          keyword: "neon signs",
          position: 4,
          feature: "featured_snippet",
          owned: false,
        },
        {
          trackingKeywordId: "c",
          keyword: "custom signs",
          position: 2,
          feature: "featured_snippet",
          owned: false,
        },
      ],
      [
        {
          trackingKeywordId: "c",
          keyword: "custom signs",
          position: 1,
          feature: "featured_snippet",
          owned: true,
        },
      ],
    );
    expect(rows.map((row) => [row.keyword, row.status])).toEqual([
      ["sign shop", "owned"],
      ["custom signs", "lost"],
      ["neon signs", "available"],
    ]);
  });

  it("treats a previously owned feature that vanished as lost", () => {
    const rows = detectSnippetOwnership(
      [],
      [
        {
          trackingKeywordId: "a",
          keyword: "sign shop",
          position: 1,
          feature: "featured_snippet",
          owned: true,
        },
      ],
    );
    expect(rows).toEqual([
      {
        trackingKeywordId: "a",
        keyword: "sign shop",
        position: 1,
        feature: "featured_snippet",
        status: "lost",
      },
    ]);
  });

  it("ignores non-notable feature types", () => {
    expect(
      detectSnippetOwnership(
        [
          {
            trackingKeywordId: "a",
            keyword: "sign shop",
            position: 3,
            feature: "organic",
            owned: false,
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
});
