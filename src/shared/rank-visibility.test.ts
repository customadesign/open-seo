import { describe, expect, it } from "vitest";
import { computeVisibility } from "./rank-visibility";

describe("computeVisibility", () => {
  it("scores position 1 as full visibility and reports the delta in points", () => {
    const score = computeVisibility([
      { searchVolume: 1000, position: 1, previousPosition: null },
    ]);
    expect(score.current).toBe(100);
    expect(score.previous).toBe(0);
    expect(score.delta).toBe(100);
  });

  it("weights by volume across entries", () => {
    // The high-volume keyword ranks first, the low-volume one is unranked, so
    // visibility is the volume share of the ranking keyword.
    const score = computeVisibility([
      { searchVolume: 900, position: 1, previousPosition: 1 },
      { searchVolume: 100, position: null, previousPosition: null },
    ]);
    expect(score.current).toBeCloseTo(90);
    expect(score.delta).toBeCloseTo(0);
  });

  it("returns null when no entry has known search volume", () => {
    expect(
      computeVisibility([
        { searchVolume: null, position: 1, previousPosition: 1 },
        { searchVolume: 0, position: 2, previousPosition: 2 },
      ]),
    ).toEqual({ current: null, previous: null, delta: null });
  });
});
