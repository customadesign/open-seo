import { describe, expect, it } from "vitest";
import type { AiVisibilityAnswer } from "@/server/lib/dataforseo/ai-visibility";
import {
  countBrandMentions,
  shapeObservation,
  shapeUnavailableObservation,
  summarizeAiVisibilityRun,
} from "./aiVisibilityObservations";

function answer(
  overrides: Partial<AiVisibilityAnswer> = {},
): AiVisibilityAnswer {
  return { text: "", modelName: null, references: [], ...overrides };
}

describe("countBrandMentions", () => {
  it("counts case-insensitively without matching inside longer words", () => {
    expect(
      countBrandMentions("Acme is great. acme wins. Acmezilla", "Acme"),
    ).toBe(2);
  });

  it("still matches brands that end in a symbol", () => {
    // A trailing \b never matches next to "!", which would zero these out.
    expect(countBrandMentions("Try Yahoo! today", "Yahoo!")).toBe(1);
  });
});

describe("shapeObservation", () => {
  it("marks the brand mentioned and flags a citation on the tracked domain", () => {
    const shaped = shapeObservation({
      brandName: "Acme",
      domain: "acme.com",
      answer: answer({
        text: "Acme is a good option.",
        references: [
          { url: "https://blog.acme.com/post", title: null },
          { url: "https://other.example/post", title: null },
        ],
      }),
    });

    expect(shaped.outcome).toBe("brand_mentioned");
    expect(shaped.mentionCount).toBe(1);
    expect(shaped.domainCited).toBe(true);
    expect(shaped.citations.map((citation) => citation.position)).toEqual([
      1, 2,
    ]);
  });

  it("drops non-http citation URLs", () => {
    const shaped = shapeObservation({
      brandName: "Acme",
      domain: "acme.com",
      answer: answer({
        text: "Acme",
        references: [{ url: "javascript:alert(1)", title: null }],
      }),
    });
    expect(shaped.citations).toEqual([]);
  });
});

describe("summarizeAiVisibilityRun", () => {
  it("excludes unavailable observations from the denominator", () => {
    const summary = summarizeAiVisibilityRun([
      { status: "completed", outcome: "brand_mentioned", mentionCount: 3 },
      { status: "completed", outcome: "brand_absent", mentionCount: 0 },
      { status: "failed", outcome: "unavailable", mentionCount: 0 },
    ]);

    expect(summary.visibilityPercent).toBe(50);
    expect(summary.mentions).toBe(3);
    expect(summary.readableObservations).toBe(2);
    expect(summary.unavailableObservations).toBe(1);
  });

  it("reports null visibility when every provider was unavailable", () => {
    const summary = summarizeAiVisibilityRun([
      shapeUnavailableObservation("boom"),
      shapeUnavailableObservation("boom"),
    ]);
    expect(summary.visibilityPercent).toBeNull();
    expect(summary.readableObservations).toBe(0);
  });
});
