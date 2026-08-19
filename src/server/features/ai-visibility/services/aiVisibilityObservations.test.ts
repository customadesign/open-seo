import { describe, expect, it } from "vitest";
import {
  countBrandMentions,
  shapeObservation,
  shapeUnavailableObservation,
} from "@/server/features/ai-visibility/services/aiVisibilityObservations";
import type { AiVisibilityAnswer } from "@/server/lib/dataforseo/ai-visibility";

function answer(
  overrides: Partial<AiVisibilityAnswer> = {},
): AiVisibilityAnswer {
  return {
    text: "",
    modelName: null,
    citations: [],
    raw: {},
    ...overrides,
  };
}

describe("countBrandMentions", () => {
  it("counts case-insensitively without matching inside longer words", () => {
    expect(
      countBrandMentions("Ahrefs and ahrefs beat Ahrefsomatic", "Ahrefs"),
    ).toBe(2);
  });

  it("still matches brands that begin or end with a symbol", () => {
    // A naive \b on both sides never matches next to a symbol, silently
    // zeroing out these brands.
    expect(countBrandMentions("Shop at C&A today", "C&A")).toBe(1);
    expect(countBrandMentions("Try Yahoo! Search", "Yahoo!")).toBe(1);
  });
});

describe("shapeObservation", () => {
  it("records a mention and a cited target domain", () => {
    const shaped = shapeObservation({
      brandName: "OpenSEO",
      domain: "openseo.so",
      answer: answer({
        text: "OpenSEO is one option.",
        modelName: "gpt-5",
        citations: [
          {
            url: "https://docs.openseo.so/guide",
            domain: "docs.openseo.so",
            position: 1,
          },
          { url: "https://other.com/post", domain: "other.com", position: 2 },
        ],
      }),
    });

    expect(shaped).toMatchObject({
      status: "completed",
      outcome: "brand_mentioned",
      mentionCount: 1,
      domainCited: true,
      modelName: "gpt-5",
    });
    // Subdomain counts as the target; unrelated domains do not.
    expect(shaped.citations.map((citation) => citation.isTargetDomain)).toEqual(
      [true, false],
    );
  });

  it("reports brand_absent with domainCited false when the answer omits the brand", () => {
    expect(
      shapeObservation({
        brandName: "OpenSEO",
        domain: "openseo.so",
        answer: answer({ text: "Try something else.", citations: [] }),
      }),
    ).toMatchObject({
      status: "completed",
      outcome: "brand_absent",
      mentionCount: 0,
      domainCited: false,
    });
  });
});

describe("shapeUnavailableObservation", () => {
  it("keeps a provider failure distinct from brand absence", () => {
    // Charting an outage as "brand absent" would invent a visibility drop.
    expect(shapeUnavailableObservation("upstream timeout")).toMatchObject({
      status: "failed",
      outcome: "unavailable",
      mentionCount: 0,
      domainCited: null,
      errorMessage: "upstream timeout",
    });
  });
});
