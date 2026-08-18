import { estimateRankCheckTaskCredits } from "@/shared/rank-tracking";
import type { AuditFixOrder } from "@/shared/audit-issues";

/**
 * Closed bucket list. New buckets are added here; idea *types* stay free-form
 * text so a new detector does not need a schema migration.
 */
export const ON_PAGE_BUCKETS = [
  "strategy",
  "content",
  "semantic",
  "backlinks",
  "ux",
  "technical",
  "serp_features",
] as const;

export type OnPageBucket = (typeof ON_PAGE_BUCKETS)[number];

export const ON_PAGE_IMPLEMENTED_BUCKETS = [
  "technical",
  "content",
  "strategy",
] as const satisfies readonly OnPageBucket[];

export type OnPageImplementedBucket =
  (typeof ON_PAGE_IMPLEMENTED_BUCKETS)[number];

/** Idea types registered by this slice. The DB column is plain text. */
export const ON_PAGE_IDEA_TYPES = [
  "technical_audit_issue",
  "content_word_count",
  "content_keyword_in_title",
  "content_keyword_in_h1",
  "content_keyword_in_body",
  "content_readability",
  "strategy_keyword_cannibalization",
  "strategy_wrong_landing_page",
] as const;

export type OnPageIdeaType = (typeof ON_PAGE_IDEA_TYPES)[number];

export type OnPagePriority = AuditFixOrder;

export const ON_PAGE_TARGET_SOURCES = [
  "rank_tracking",
  "saved_keyword",
  "manual",
] as const;

export type OnPageTargetSource = (typeof ON_PAGE_TARGET_SOURCES)[number];

/** Cap on pages that receive the paid top-10 content comparison in one run. */
export const MAX_ON_PAGE_PAGES_PER_RUN = 10;

/** Live SERP depth for the content comparison. One billed page. */
export const ON_PAGE_SERP_DEPTH = 10;

export const ON_PAGE_BUCKET_LABELS: Record<OnPageBucket, string> = {
  strategy: "Strategy",
  content: "Content",
  semantic: "Semantic",
  backlinks: "Backlinks",
  ux: "UX",
  technical: "Technical",
  serp_features: "SERP Features",
};

export const ON_PAGE_IDEA_TYPE_LABELS: Record<OnPageIdeaType, string> = {
  technical_audit_issue: "Site-audit issue",
  content_word_count: "Word count vs top 10",
  content_keyword_in_title: "Keyword missing from title",
  content_keyword_in_h1: "Keyword missing from H1",
  content_keyword_in_body: "Keyword missing from body",
  content_readability: "Readability vs top 10",
  strategy_keyword_cannibalization: "Keyword cannibalization",
  strategy_wrong_landing_page: "Target keyword is not the ranking keyword",
};

export const ON_PAGE_PRIORITY_LABELS: Record<OnPagePriority, string> = {
  now: "Now",
  next: "Next",
  improve: "Improve",
  monitor: "Monitor",
};

export const ON_PAGE_PRIORITY_RANK: Record<OnPagePriority, number> = {
  now: 0,
  next: 1,
  improve: 2,
  monitor: 3,
};

export function isOnPageBucket(value: string): value is OnPageBucket {
  return (ON_PAGE_BUCKETS as readonly string[]).includes(value);
}

export function isOnPageIdeaType(value: string): value is OnPageIdeaType {
  return (ON_PAGE_IDEA_TYPES as readonly string[]).includes(value);
}

export function isOnPagePriority(value: string): value is OnPagePriority {
  return (
    value === "now" ||
    value === "next" ||
    value === "improve" ||
    value === "monitor"
  );
}

export function normalizeOnPageKeyword(input: string): string {
  return input.trim().toLowerCase();
}

/** Live SERP cost for uncached (keyword, location, language) triples. */
export function estimateOnPageSerpCredits(uncachedKeywordCount: number) {
  return estimateRankCheckTaskCredits(
    uncachedKeywordCount,
    ON_PAGE_SERP_DEPTH,
    "live",
  );
}

export function onPageSerpCacheDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
