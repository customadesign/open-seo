import { z } from "zod";
import { getIssueDescriptor } from "@/shared/audit-issues";
import { canonicalUrlKey } from "@/server/lib/audit/url-utils";
import {
  ON_PAGE_IDEA_TYPE_LABELS,
  type OnPageBucket,
  type OnPageIdeaType,
  type OnPagePriority,
} from "@/shared/on-page";

export type OnPageEvidenceValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[];

export type OnPageEvidence = Record<string, OnPageEvidenceValue>;

export type DetectedOnPageIdea = {
  targetPageId: string;
  targetKeywordId: string | null;
  bucket: OnPageBucket;
  ideaType: OnPageIdeaType;
  priority: OnPagePriority;
  title: string;
  summary: string;
  evidence: OnPageEvidence;
  dedupeKey: string;
};

export type ParsedPageSnapshot = {
  url: string;
  title: string;
  h1s: string[];
  bodyText: string;
  wordCount: number;
  fleschReadingEase: number | null;
};

export type AuditIssueInput = {
  issueType: string;
  severity: "critical" | "warning" | "info";
  pageUrl: string;
  detailsJson: string | null;
};

export type TargetKeywordInput = {
  pageId: string;
  pageUrl: string;
  keywordId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
};

export type RankingInput = {
  url: string | null;
  keyword: string;
  position: number | null;
};

const WORD_COUNT_RATIO = 0.7;
const MIN_COMPETITOR_SAMPLE = 3;
const READABILITY_GAP = 15;
const WRONG_LANDING_TOP_N = 10;

export function pageContainsKeyword(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  return text.toLowerCase().includes(keyword.toLowerCase().trim());
}

export function ideaDedupeKey(parts: string[]): string {
  return parts.join("|");
}

export function fleschReadingEase(text: string): number | null {
  const words = text.match(/[A-Za-z0-9']+/g) ?? [];
  if (words.length < 30) return null;
  const sentences = text
    .split(/[.!?]+/)
    .filter((part) => part.trim().length > 0);
  if (sentences.length === 0) return null;
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const score =
    206.835 -
    1.015 * (words.length / sentences.length) -
    84.6 * (syllables / words.length);
  return Math.round(score * 10) / 10;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length <= 3) return 1;
  const groups = cleaned.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const extraDetailsSchema = z
  .object({
    dedupeKey: z.string().optional(),
    targetUrl: z.string().optional(),
  })
  .passthrough();

function extraDedupeKey(detailsJson: string | null): string {
  if (!detailsJson) return "";
  try {
    const parsed = extraDetailsSchema.safeParse(JSON.parse(detailsJson));
    if (!parsed.success) return "";
    return parsed.data.dedupeKey ?? parsed.data.targetUrl ?? "";
  } catch {
    return "";
  }
}

export function mapTechnicalIdeas(input: {
  targetPageId: string;
  pageUrl: string;
  issues: AuditIssueInput[];
}): DetectedOnPageIdea[] {
  const pageKey = canonicalUrlKey(input.pageUrl);
  const ideas: DetectedOnPageIdea[] = [];
  for (const issue of input.issues) {
    if (canonicalUrlKey(issue.pageUrl) !== pageKey) continue;
    const descriptor = getIssueDescriptor(issue.issueType);
    const extraKey = extraDedupeKey(issue.detailsJson);
    ideas.push({
      targetPageId: input.targetPageId,
      targetKeywordId: null,
      bucket: "technical",
      ideaType: "technical_audit_issue",
      priority: descriptor?.fixOrder ?? "improve",
      title: descriptor?.title ?? issue.issueType,
      summary:
        descriptor?.howToFix ??
        `Fix the "${issue.issueType}" issue reported by the latest site audit.`,
      evidence: {
        issueType: issue.issueType,
        severity: issue.severity,
        pageUrl: issue.pageUrl,
        category: descriptor?.category ?? "technical",
        impact: descriptor?.impact ?? "low",
        effort: descriptor?.effort ?? "medium",
        explanation: descriptor?.explanation ?? null,
        detailsJson: issue.detailsJson,
      },
      dedupeKey: ideaDedupeKey([
        "technical",
        input.targetPageId,
        issue.issueType,
        extraKey,
      ]),
    });
  }
  return ideas;
}

export function detectContentIdeas(input: {
  targetPageId: string;
  targetKeywordId: string;
  keyword: string;
  target: ParsedPageSnapshot;
  competitors: ParsedPageSnapshot[];
}): DetectedOnPageIdea[] {
  const ideas: DetectedOnPageIdea[] = [];
  const keyword = input.keyword.trim();
  const pageId = input.targetPageId;
  const keywordId = input.targetKeywordId;

  if (!pageContainsKeyword(input.target.title, keyword)) {
    ideas.push({
      targetPageId: pageId,
      targetKeywordId: keywordId,
      bucket: "content",
      ideaType: "content_keyword_in_title",
      priority: "now",
      title: ON_PAGE_IDEA_TYPE_LABELS.content_keyword_in_title,
      summary: `The title does not include “${keyword}”.`,
      evidence: {
        keyword,
        title: input.target.title,
        present: false,
      },
      dedupeKey: ideaDedupeKey([
        "content",
        "keyword_in_title",
        pageId,
        keywordId,
      ]),
    });
  }

  const h1Text = input.target.h1s.join(" ");
  if (!pageContainsKeyword(h1Text, keyword)) {
    ideas.push({
      targetPageId: pageId,
      targetKeywordId: keywordId,
      bucket: "content",
      ideaType: "content_keyword_in_h1",
      priority: "next",
      title: ON_PAGE_IDEA_TYPE_LABELS.content_keyword_in_h1,
      summary: `None of the H1 headings include “${keyword}”.`,
      evidence: {
        keyword,
        h1s: input.target.h1s,
        present: false,
      },
      dedupeKey: ideaDedupeKey(["content", "keyword_in_h1", pageId, keywordId]),
    });
  }

  if (!pageContainsKeyword(input.target.bodyText, keyword)) {
    ideas.push({
      targetPageId: pageId,
      targetKeywordId: keywordId,
      bucket: "content",
      ideaType: "content_keyword_in_body",
      priority: "next",
      title: ON_PAGE_IDEA_TYPE_LABELS.content_keyword_in_body,
      summary: `The visible body text does not include “${keyword}”.`,
      evidence: {
        keyword,
        wordCount: input.target.wordCount,
        present: false,
      },
      dedupeKey: ideaDedupeKey([
        "content",
        "keyword_in_body",
        pageId,
        keywordId,
      ]),
    });
  }

  const competitorWordCounts = input.competitors
    .map((page) => page.wordCount)
    .filter((count) => count > 0);
  const recommendedWordCount = median(competitorWordCounts);
  if (
    recommendedWordCount != null &&
    competitorWordCounts.length >= MIN_COMPETITOR_SAMPLE &&
    input.target.wordCount < recommendedWordCount * WORD_COUNT_RATIO
  ) {
    ideas.push({
      targetPageId: pageId,
      targetKeywordId: keywordId,
      bucket: "content",
      ideaType: "content_word_count",
      priority: "next",
      title: ON_PAGE_IDEA_TYPE_LABELS.content_word_count,
      summary: `This page has ${input.target.wordCount} words; the top-10 median is ${Math.round(recommendedWordCount)}.`,
      evidence: {
        wordCount: input.target.wordCount,
        recommendedWordCount: Math.round(recommendedWordCount),
        competitorSample: competitorWordCounts.length,
        ratio: WORD_COUNT_RATIO,
      },
      dedupeKey: ideaDedupeKey(["content", "word_count", pageId, keywordId]),
    });
  }

  const competitorReadability = input.competitors
    .map((page) => page.fleschReadingEase)
    .filter((score): score is number => score != null);
  const recommendedReadability = median(competitorReadability);
  if (
    input.target.fleschReadingEase != null &&
    recommendedReadability != null &&
    competitorReadability.length >= MIN_COMPETITOR_SAMPLE &&
    recommendedReadability - input.target.fleschReadingEase >= READABILITY_GAP
  ) {
    ideas.push({
      targetPageId: pageId,
      targetKeywordId: keywordId,
      bucket: "content",
      ideaType: "content_readability",
      priority: "improve",
      title: ON_PAGE_IDEA_TYPE_LABELS.content_readability,
      summary: `Flesch Reading Ease is ${input.target.fleschReadingEase}; the top-10 median is ${recommendedReadability}.`,
      evidence: {
        fleschReadingEase: input.target.fleschReadingEase,
        recommendedFleschReadingEase: recommendedReadability,
        competitorSample: competitorReadability.length,
        gap: READABILITY_GAP,
      },
      dedupeKey: ideaDedupeKey(["content", "readability", pageId, keywordId]),
    });
  }

  return ideas;
}

export function detectStrategyIdeas(input: {
  targets: TargetKeywordInput[];
  rankings: RankingInput[];
}): DetectedOnPageIdea[] {
  const ideas: DetectedOnPageIdea[] = [];
  const byKeyword = new Map<string, TargetKeywordInput[]>();
  for (const target of input.targets) {
    const key = `${target.keyword}|${target.locationCode}|${target.languageCode}`;
    const group = byKeyword.get(key) ?? [];
    group.push(target);
    byKeyword.set(key, group);
  }

  for (const group of byKeyword.values()) {
    const uniquePages = [
      ...new Map(group.map((row) => [row.pageId, row])).values(),
    ];
    if (uniquePages.length < 2) continue;
    const competingUrls = uniquePages.map((row) => row.pageUrl);
    for (const target of uniquePages) {
      ideas.push({
        targetPageId: target.pageId,
        targetKeywordId: target.keywordId,
        bucket: "strategy",
        ideaType: "strategy_keyword_cannibalization",
        priority: "now",
        title: ON_PAGE_IDEA_TYPE_LABELS.strategy_keyword_cannibalization,
        summary: `${uniquePages.length} target pages compete for “${target.keyword}”.`,
        evidence: {
          keyword: target.keyword,
          competingUrls,
          competingPageCount: uniquePages.length,
        },
        dedupeKey: ideaDedupeKey([
          "strategy",
          "cannibalization",
          target.pageId,
          target.keyword,
          String(target.locationCode),
          target.languageCode,
        ]),
      });
    }
  }

  for (const target of input.targets) {
    const pageKey = canonicalUrlKey(target.pageUrl);
    const ranksForTarget = input.rankings.filter(
      (row) =>
        row.keyword === target.keyword &&
        row.url != null &&
        canonicalUrlKey(row.url) === pageKey &&
        row.position != null,
    );
    if (ranksForTarget.length > 0) continue;

    const better = input.rankings
      .filter(
        (row) =>
          row.keyword !== target.keyword &&
          row.url != null &&
          canonicalUrlKey(row.url) === pageKey &&
          row.position != null &&
          row.position <= WRONG_LANDING_TOP_N,
      )
      .toSorted((a, b) => (a.position ?? 99) - (b.position ?? 99))[0];
    if (!better || better.url == null || better.position == null) continue;

    ideas.push({
      targetPageId: target.pageId,
      targetKeywordId: target.keywordId,
      bucket: "strategy",
      ideaType: "strategy_wrong_landing_page",
      priority: "next",
      title: ON_PAGE_IDEA_TYPE_LABELS.strategy_wrong_landing_page,
      summary: `This page does not rank for “${target.keyword}”, but ranks #${better.position} for “${better.keyword}”.`,
      evidence: {
        targetKeyword: target.keyword,
        rankingKeyword: better.keyword,
        rankingPosition: better.position,
        rankingUrl: better.url,
      },
      dedupeKey: ideaDedupeKey([
        "strategy",
        "wrong_landing",
        target.pageId,
        target.keywordId,
      ]),
    });
  }

  return ideas;
}
