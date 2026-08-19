import { describe, expect, it } from "vitest";
import { changeEventDelta } from "./changeEventPresentation";

describe("changeEventDelta", () => {
  it("falls back to the absolute change when the baseline is zero", () => {
    // `audit.improvement` always records previous = 0, so a percent change here
    // would be Infinity.
    expect(
      changeEventDelta({
        previousNumericValue: 0,
        currentNumericValue: 3,
        unit: "issues",
      }),
    ).toEqual({ direction: "up", label: "3" });

    expect(
      changeEventDelta({
        previousNumericValue: 5,
        currentNumericValue: 19,
        unit: "key events",
      }),
    ).toEqual({ direction: "up", label: "280%" });
  });

  it("reports rate movement in percentage points, not a percent of a percent", () => {
    expect(
      changeEventDelta({
        previousNumericValue: 0.584,
        currentNumericValue: 0.503,
        unit: "rate",
      }),
    ).toEqual({ direction: "down", label: "8.1 points" });
  });
});
