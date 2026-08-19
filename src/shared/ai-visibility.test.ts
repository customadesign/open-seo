import { describe, expect, it } from "vitest";
import {
  estimateAiVisibilityRunCredits,
  MAX_PROMPTS_PER_CONFIG,
} from "@/shared/ai-visibility";

describe("estimateAiVisibilityRunCredits", () => {
  it("charges one observation per prompt per provider", () => {
    const single = estimateAiVisibilityRunCredits({
      promptCount: 10,
      providers: ["gemini"],
    });
    const both = estimateAiVisibilityRunCredits({
      promptCount: 10,
      providers: ["gemini", "google_ai_mode"],
    });

    expect(single.observations).toBe(10);
    expect(both.observations).toBe(20);
    expect(both.costCredits).toBeGreaterThan(single.costCredits);
  });

  it("accumulates per call rather than rounding the total once", () => {
    // Metering rounds and ceilings every provider call independently, so a
    // single rounded total would under-charge the run.
    const one = estimateAiVisibilityRunCredits({
      promptCount: 1,
      providers: ["chatgpt_search"],
    });
    const many = estimateAiVisibilityRunCredits({
      promptCount: 7,
      providers: ["chatgpt_search"],
    });

    expect(many.costCredits).toBe(one.costCredits * 7);
  });

  it("costs nothing when no providers are enabled", () => {
    // The default for a new config: owning one must never bill.
    expect(
      estimateAiVisibilityRunCredits({ promptCount: 50, providers: [] }),
    ).toEqual({ observations: 0, costUsd: 0, costCredits: 0 });
  });

  it("keeps the maximum run bounded by the prompt cap", () => {
    const max = estimateAiVisibilityRunCredits({
      promptCount: MAX_PROMPTS_PER_CONFIG,
      providers: ["chatgpt_search", "gemini", "google_ai_mode"],
    });
    expect(max.observations).toBe(MAX_PROMPTS_PER_CONFIG * 3);
  });
});
