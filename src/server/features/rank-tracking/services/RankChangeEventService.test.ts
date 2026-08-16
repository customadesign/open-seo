import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));

import { analyzeRankMovement } from "./RankChangeEventService";

function snapshot(
  id: number,
  keywordId: string,
  keyword: string,
  device: "desktop" | "mobile",
  position: number | null,
) {
  return {
    id,
    runId: id < 10 ? "previous" : "current",
    trackingKeywordId: keywordId,
    keyword,
    device,
    position,
    url: null,
    serpFeatures: null,
    checkedAt: "2026-08-17T00:00:00.000Z",
  };
}

describe("analyzeRankMovement", () => {
  it("flags only material movement and top-ten crossings", () => {
    const previous = [
      snapshot(1, "a", "alpha", "desktop", 14),
      snapshot(2, "b", "beta", "desktop", 8),
      snapshot(3, "c", "gamma", "mobile", 20),
      snapshot(4, "d", "delta", "mobile", 5),
      snapshot(5, "e", "epsilon", "desktop", 2),
    ];
    const current = [
      snapshot(11, "a", "alpha", "desktop", 9),
      snapshot(12, "b", "beta", "desktop", 12),
      snapshot(13, "c", "gamma", "mobile", 18),
      snapshot(14, "d", "delta", "mobile", null),
      snapshot(15, "e", "epsilon", "desktop", 3),
    ];

    const result = analyzeRankMovement(current, previous);
    expect(result).toMatchObject({
      compared: 5,
      enteredTopTen: 1,
      leftTopTen: 2,
      previousTopTen: 3,
      currentTopTen: 2,
    });
    expect(result.improved.map(({ keyword }) => keyword)).toEqual(["alpha"]);
    expect(result.declined.map(({ keyword }) => keyword)).toEqual([
      "beta",
      "delta",
    ]);
  });

  it("treats newly found and newly lost rankings as material", () => {
    const result = analyzeRankMovement(
      [
        snapshot(11, "a", "alpha", "desktop", 30),
        snapshot(12, "b", "beta", "desktop", null),
      ],
      [
        snapshot(1, "a", "alpha", "desktop", null),
        snapshot(2, "b", "beta", "desktop", 25),
      ],
    );
    expect(result.improved).toHaveLength(1);
    expect(result.declined).toHaveLength(1);
  });
});
