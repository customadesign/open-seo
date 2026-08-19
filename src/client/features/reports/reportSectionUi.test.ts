import { describe, expect, it } from "vitest";
import {
  aiAnswerShareLabel,
  coverageChange,
  freshnessLabel,
  sectionUnavailableLabel,
} from "./reportSectionUi";

describe("aiAnswerShareLabel", () => {
  it("reports unanswered prompts separately from the answered share", () => {
    expect(
      aiAnswerShareLabel({ answered: 2, unavailable: 1, answerShare: 0.5 }),
    ).toBe("50% of 2 answers · 1 unavailable");
  });

  it("says no answers came back rather than showing 0%", () => {
    expect(
      aiAnswerShareLabel({ answered: 0, unavailable: 3, answerShare: null }),
    ).toBe("No answers returned · 3 unavailable");
  });
});

describe("freshnessLabel", () => {
  it("marks data captured before the period so it cannot read as current", () => {
    expect(
      freshnessLabel({
        capturedAt: "2026-05-10T00:00:00.000Z",
        ageDays: 82,
        isStale: true,
      }),
    ).toContain("predates this report");
  });

  it("states only the capture date for data inside the period", () => {
    expect(
      freshnessLabel({
        capturedAt: "2026-07-20T00:00:00.000Z",
        ageDays: 11,
        isStale: false,
      }),
    ).toBe("Captured Jul 20, 2026");
  });
});

describe("sectionUnavailableLabel", () => {
  it("falls back to a neutral phrase for a reason this build does not know", () => {
    expect(sectionUnavailableLabel("something_new")).toBe(
      "no usable stored data",
    );
  });
});

describe("coverageChange", () => {
  it("returns null when there is no prior run to compare against", () => {
    expect(coverageChange(0.4, undefined)).toBeNull();
    expect(coverageChange(0.4, 0.25)).toBeCloseTo(0.15);
  });
});
