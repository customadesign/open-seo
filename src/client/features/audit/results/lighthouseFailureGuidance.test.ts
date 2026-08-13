import { describe, expect, it } from "vitest";
import {
  getLighthouseFailureGuidance,
  groupLighthouseFailures,
  type LighthouseFailureRow,
} from "./lighthouseFailureGuidance";

describe("getLighthouseFailureGuidance", () => {
  it.each([
    ["DataForSEO HTTP 402 on /v3/on_page/lighthouse/live/json", "billing"],
    ["HTTP 401 unauthorized", "authentication"],
    ["HTTP 429 too many requests", "rate-limit"],
    ["The provider timed out", "timeout"],
    ["DataForSEO HTTP 503", "upstream"],
    ["Lighthouse returned no category scores", "missing-scores"],
    ["A new provider error", "unknown"],
  ] as const)("classifies %s as %s", (message, kind) => {
    expect(getLighthouseFailureGuidance(message).kind).toBe(kind);
  });

  it("classifies an empty error as missing scores", () => {
    expect(getLighthouseFailureGuidance(null).kind).toBe("missing-scores");
  });
});

describe("groupLighthouseFailures", () => {
  it("groups identical failures and keeps each URL and device", () => {
    const failures = [
      makeFailure({ id: "mobile", strategy: "mobile" }),
      makeFailure({ id: "desktop", strategy: "desktop" }),
    ];

    const groups = groupLighthouseFailures(failures, [
      { id: "page-1", url: "https://example.com/category/" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].guidance.kind).toBe("billing");
    expect(groups[0].tests).toEqual([
      {
        id: "desktop",
        pageUrl: "https://example.com/category/",
        strategy: "desktop",
      },
      {
        id: "mobile",
        pageUrl: "https://example.com/category/",
        strategy: "mobile",
      },
    ]);
  });

  it("omits successful Lighthouse rows", () => {
    const successful = makeFailure({
      id: "ok",
      errorMessage: null,
      performanceScore: 90,
      accessibilityScore: 90,
      bestPracticesScore: 90,
      seoScore: 90,
    });

    expect(groupLighthouseFailures([successful], [])).toEqual([]);
  });
});

function makeFailure(
  overrides: Partial<LighthouseFailureRow> = {},
): LighthouseFailureRow {
  return {
    id: "failure-1",
    pageId: "page-1",
    strategy: "mobile",
    errorMessage: "DataForSEO HTTP 402 on /v3/on_page/lighthouse/live/json",
    performanceScore: null,
    accessibilityScore: null,
    bestPracticesScore: null,
    seoScore: null,
    ...overrides,
  };
}
