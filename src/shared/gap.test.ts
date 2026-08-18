import { describe, expect, it } from "vitest";
import {
  classifyKeywordGap,
  estimateBacklinkGapCredits,
  estimateKeywordGapCredits,
} from "./gap";

describe("classifyKeywordGap", () => {
  it("marks a keyword unique when only the base domain ranks", () => {
    expect(
      classifyKeywordGap({
        basePosition: 4,
        competitorPositions: [null, null],
      }),
    ).toBe("unique");
  });

  it("marks a keyword missing when every competitor ranks and the base does not", () => {
    expect(
      classifyKeywordGap({
        basePosition: null,
        competitorPositions: [3, 8],
      }),
    ).toBe("missing");
  });

  it("marks a keyword untapped when some but not all competitors rank and the base does not", () => {
    expect(
      classifyKeywordGap({
        basePosition: null,
        competitorPositions: [2, null],
      }),
    ).toBe("untapped");
  });

  it("marks a keyword strong when the base outranks every ranking competitor", () => {
    expect(
      classifyKeywordGap({
        basePosition: 2,
        competitorPositions: [6, 9],
      }),
    ).toBe("strong");
  });

  it("marks a keyword weak when the base ranks worse than every ranking competitor", () => {
    expect(
      classifyKeywordGap({
        basePosition: 18,
        competitorPositions: [3, 7],
      }),
    ).toBe("weak");
  });

  it("marks a keyword shared when every domain ranks and the base is neither best nor worst", () => {
    expect(
      classifyKeywordGap({
        basePosition: 5,
        competitorPositions: [2, 12],
      }),
    ).toBe("shared");
  });
});

describe("gap cost estimates", () => {
  it("scales keyword-gap credits with the number of uncached domains", () => {
    const one = estimateKeywordGapCredits(1);
    const five = estimateKeywordGapCredits(5);
    expect(five.costCredits).toBe(one.costCredits * 5);
    expect(five.costUsd).toBeGreaterThan(one.costUsd);
  });

  it("returns zero credits when every domain is already cached", () => {
    expect(estimateKeywordGapCredits(0)).toEqual({
      costUsd: 0,
      costCredits: 0,
    });
    expect(estimateBacklinkGapCredits(0)).toEqual({
      costUsd: 0,
      costCredits: 0,
    });
  });
});
