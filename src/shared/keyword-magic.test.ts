import { describe, expect, it } from "vitest";
import {
  estimateKeywordMagicLabsRequests,
  estimateKeywordMagicRunCredits,
  keywordMagicFingerprint,
} from "./keyword-magic";

describe("keyword magic cost estimate", () => {
  it("sizes Labs fan-out from the requested scale without calling a provider", () => {
    expect(estimateKeywordMagicLabsRequests(10_000)).toEqual({
      suggestionPages: 10,
      relatedPages: 1,
      ideaPages: 1,
      totalRequests: 12,
    });
  });

  it("keeps the same seed fingerprint for the same inputs", () => {
    const input = {
      seed: "crm software",
      locationCode: 2840,
      languageCode: "en",
      clickstream: false,
      maxKeywords: 10_000,
    };
    expect(keywordMagicFingerprint(input)).toBe(keywordMagicFingerprint(input));
    expect(keywordMagicFingerprint({ ...input, clickstream: true })).not.toBe(
      keywordMagicFingerprint(input),
    );
  });

  it("charges clickstream as a doubled Labs request", () => {
    const plain = estimateKeywordMagicRunCredits({
      maxKeywords: 1000,
      clickstream: false,
      provider: "labs",
      hosted: true,
    });
    const clickstream = estimateKeywordMagicRunCredits({
      maxKeywords: 1000,
      clickstream: true,
      provider: "labs",
      hosted: true,
    });
    expect(clickstream.costCredits).toBeGreaterThan(plain.costCredits);
    expect(clickstream.requests).toBe(plain.requests);
  });
});
