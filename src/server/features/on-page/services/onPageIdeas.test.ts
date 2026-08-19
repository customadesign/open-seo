import { describe, expect, it } from "vitest";
import {
  detectContentIdeas,
  detectStrategyIdeas,
  fleschReadingEase,
  ideaDedupeKey,
  mapTechnicalIdeas,
  pageContainsKeyword,
  type ParsedPageSnapshot,
} from "./onPageIdeas";

function page(
  overrides: Partial<ParsedPageSnapshot> & Pick<ParsedPageSnapshot, "url">,
): ParsedPageSnapshot {
  return {
    title: "About us",
    h1s: ["About us"],
    bodyText: "Welcome to the company site.",
    wordCount: 80,
    fleschReadingEase: 70,
    ...overrides,
  };
}

describe("pageContainsKeyword", () => {
  it("matches the keyword case-insensitively inside the text", () => {
    expect(
      pageContainsKeyword("Best Sign Shop in Escondido", "sign shop"),
    ).toBe(true);
    expect(pageContainsKeyword("Best Sign Shop in Escondido", "awning")).toBe(
      false,
    );
  });
});

describe("ideaDedupeKey", () => {
  it("joins parts so the same page and type collide across runs", () => {
    expect(ideaDedupeKey(["content", "word_count", "page-1", "kw-1"])).toBe(
      "content|word_count|page-1|kw-1",
    );
  });
});

describe("mapTechnicalIdeas", () => {
  it("maps an audit issue on the target page and ignores other URLs", () => {
    const ideas = mapTechnicalIdeas({
      targetPageId: "page-1",
      pageUrl: "https://example.com/about",
      issues: [
        {
          issueType: "missing-title",
          severity: "critical",
          pageUrl: "https://example.com/about",
          detailsJson: null,
        },
        {
          issueType: "missing-h1",
          severity: "warning",
          pageUrl: "https://example.com/other",
          detailsJson: null,
        },
      ],
    });

    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({
      bucket: "technical",
      ideaType: "technical_audit_issue",
      priority: "now",
      targetKeywordId: null,
      evidence: { issueType: "missing-title" },
    });
    expect(ideas[0].dedupeKey).toBe("technical|page-1|missing-title|");
  });
});

describe("detectContentIdeas", () => {
  it("recommends a longer page when the target is well below the top-10 median", () => {
    const competitors = [400, 420, 450, 480, 500].map((wordCount, index) =>
      page({
        url: `https://competitor.test/${index}`,
        wordCount,
        bodyText: "x ".repeat(wordCount),
        fleschReadingEase: 60,
      }),
    );

    const ideas = detectContentIdeas({
      targetPageId: "page-1",
      targetKeywordId: "kw-1",
      keyword: "sign shop",
      target: page({
        url: "https://example.com/about",
        wordCount: 80,
        title: "About us",
        h1s: ["About us"],
        bodyText: "Welcome to the company.",
      }),
      competitors,
    });

    expect(ideas.map((idea) => idea.ideaType).toSorted()).toEqual([
      "content_keyword_in_body",
      "content_keyword_in_h1",
      "content_keyword_in_title",
      "content_word_count",
    ]);
    const wordCount = ideas.find(
      (idea) => idea.ideaType === "content_word_count",
    );
    expect(wordCount?.evidence).toMatchObject({
      wordCount: 80,
      recommendedWordCount: 450,
    });
  });
});

describe("detectStrategyIdeas", () => {
  it("flags two target pages that share a keyword", () => {
    const ideas = detectStrategyIdeas({
      targets: [
        {
          pageId: "page-a",
          pageUrl: "https://example.com/a",
          keywordId: "kw-a",
          keyword: "sign shop",
          locationCode: 2840,
          languageCode: "en",
        },
        {
          pageId: "page-b",
          pageUrl: "https://example.com/b",
          keywordId: "kw-b",
          keyword: "sign shop",
          locationCode: 2840,
          languageCode: "en",
        },
      ],
      rankings: [],
    });

    expect(ideas).toHaveLength(2);
    expect(
      ideas.every(
        (idea) => idea.ideaType === "strategy_keyword_cannibalization",
      ),
    ).toBe(true);
  });

  it("flags a target keyword the page does not rank for when it ranks well for another", () => {
    const ideas = detectStrategyIdeas({
      targets: [
        {
          pageId: "page-a",
          pageUrl: "https://example.com/services",
          keywordId: "kw-a",
          keyword: "neon signs",
          locationCode: 2840,
          languageCode: "en",
        },
      ],
      rankings: [
        {
          url: "https://example.com/services",
          keyword: "sign shop",
          position: 3,
        },
        {
          url: "https://other.test/",
          keyword: "neon signs",
          position: 4,
        },
      ],
    });

    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.ideaType).toBe("strategy_wrong_landing_page");
    expect(ideas[0]?.evidence.targetKeyword).toBe("neon signs");
    expect(ideas[0]?.evidence.rankingKeyword).toBe("sign shop");
    expect(ideas[0]?.evidence.rankingPosition).toBe(3);
  });
});

describe("fleschReadingEase", () => {
  it("returns null for text too short to score", () => {
    expect(fleschReadingEase("Too short.")).toBeNull();
  });
});
