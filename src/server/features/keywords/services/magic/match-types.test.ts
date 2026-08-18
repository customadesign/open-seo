import { describe, expect, it } from "vitest";
import {
  isBroadMatch,
  isExactMatch,
  isPhraseMatch,
  isQuestionKeyword,
  isRelatedMatch,
  keywordWordCount,
  matchesKeywordMagicType,
} from "./match-types";

describe("keyword magic match types", () => {
  it("treats Broad as every seed token present in any order", () => {
    expect(isBroadMatch("crm software best", "best crm")).toBe(true);
    expect(isBroadMatch("best crm for startups", "best crm")).toBe(true);
    expect(isBroadMatch("best software", "best crm")).toBe(false);
  });

  it("treats Phrase as a contiguous seed token sequence", () => {
    expect(isPhraseMatch("best crm software", "best crm")).toBe(true);
    expect(isPhraseMatch("crm best software", "best crm")).toBe(false);
  });

  it("treats Exact as equal tokens ignoring punctuation", () => {
    expect(isExactMatch("best-crm", "best crm")).toBe(true);
    expect(isExactMatch("best crm software", "best crm")).toBe(false);
  });

  it("treats Related as the complement of Broad", () => {
    expect(isRelatedMatch("crm alternatives", "best crm")).toBe(true);
    expect(isRelatedMatch("best crm software", "best crm")).toBe(false);
  });

  it("detects question keywords by starter or question mark", () => {
    expect(isQuestionKeyword("what is the best crm")).toBe(true);
    expect(isQuestionKeyword("crm vs erp?")).toBe(true);
    expect(isQuestionKeyword("best crm software")).toBe(false);
  });

  it("routes match-type tabs through the documented predicates", () => {
    expect(matchesKeywordMagicType("best crm", "best crm", "exact")).toBe(true);
    expect(
      matchesKeywordMagicType("how to pick a crm", "crm", "questions"),
    ).toBe(true);
    expect(matchesKeywordMagicType("anything", "crm", "all")).toBe(true);
  });

  it("counts tokens the same way match types tokenize", () => {
    expect(keywordWordCount("best-crm software")).toBe(3);
  });
});
