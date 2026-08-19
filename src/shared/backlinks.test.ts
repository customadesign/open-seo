import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_ANCHOR_SHARE_THRESHOLD,
  classifyAnchorText,
  estimateBacklinksBulkCredits,
} from "./backlinks";

describe("classifyAnchorText", () => {
  it("treats leftover keyword phrases as commercial", () => {
    expect(classifyAnchorText("buy cheap widgets", "example.com")).toBe(
      "commercial",
    );
    expect(classifyAnchorText("https://example.com/path", "example.com")).toBe(
      "naked",
    );
    expect(classifyAnchorText("click here", "example.com")).toBe("generic");
    expect(classifyAnchorText("Example Home", "example.com")).toBe("brand");
  });
});

describe("estimateBacklinksBulkCredits", () => {
  it("prices one four-call batch regardless of target count", () => {
    const estimate = estimateBacklinksBulkCredits();
    expect(estimate.calls).toBe(4);
    expect(estimate.costCredits).toBeGreaterThan(0);
    expect(estimate.billedTargetLimit).toBe(200);
    expect(COMMERCIAL_ANCHOR_SHARE_THRESHOLD).toBe(0.15);
  });
});
