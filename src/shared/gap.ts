import {
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  applyBillingMarkupUsd,
  roundUsdForBilling,
} from "@/shared/billing";

export const KEYWORD_GAP_CLASSIFICATIONS = [
  "shared",
  "missing",
  "weak",
  "strong",
  "untapped",
  "unique",
] as const;

export type KeywordGapClassification =
  (typeof KEYWORD_GAP_CLASSIFICATIONS)[number];

export const MAX_KEYWORD_GAP_COMPETITORS = 4;
export const MAX_BACKLINK_GAP_COMPETITORS = 3;
export const KEYWORD_GAP_SNAPSHOT_LIMIT = 1000;
export const BACKLINK_GAP_SNAPSHOT_LIMIT = 1000;
export const KEYWORD_GAP_TTL_MS = 12 * 60 * 60 * 1000;
export const BACKLINK_GAP_TTL_MS = 6 * 60 * 60 * 1000;

/** DataForSEO Labs ranked keywords live: $0.01/task + $0.0001/row. */
const LABS_RANKED_KEYWORDS_TASK_USD = 0.01;
const LABS_RANKED_KEYWORDS_ROW_USD = 0.0001;

/** DataForSEO Backlinks referring domains live: $0.02/task. */
const BACKLINKS_REFERRING_DOMAINS_TASK_USD = 0.02;

export function gapCostApprovalError(
  costCredits: number,
  maxCostCredits: number,
) {
  return `This comparison costs ${costCredits} credits, above the approved maximum of ${maxCostCredits}. Re-estimate and approve the updated amount.`;
}

export function estimateKeywordGapCredits(billedDomainCount: number) {
  return estimateMeteredCalls(
    billedDomainCount,
    LABS_RANKED_KEYWORDS_TASK_USD +
      LABS_RANKED_KEYWORDS_ROW_USD * KEYWORD_GAP_SNAPSHOT_LIMIT,
  );
}

export function estimateBacklinkGapCredits(billedDomainCount: number) {
  return estimateMeteredCalls(
    billedDomainCount,
    BACKLINKS_REFERRING_DOMAINS_TASK_USD,
  );
}

function estimateMeteredCalls(callCount: number, rawUsdPerCall: number) {
  let costUsd = 0;
  let costCredits = 0;
  for (let index = 0; index < callCount; index += 1) {
    const callCostUsd = applyBillingMarkupUsd(rawUsdPerCall);
    costUsd += callCostUsd;
    costCredits += Math.ceil(callCostUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD);
  }
  return {
    costUsd: roundUsdForBilling(costUsd),
    costCredits,
  };
}

export function classifyKeywordGap(input: {
  basePosition: number | null;
  competitorPositions: Array<number | null>;
}): KeywordGapClassification {
  const rankedCompetitors = input.competitorPositions.filter(
    (position): position is number => position != null,
  );
  const allCompetitorsRank =
    rankedCompetitors.length === input.competitorPositions.length &&
    rankedCompetitors.length > 0;

  if (input.basePosition == null) {
    return allCompetitorsRank ? "missing" : "untapped";
  }
  if (rankedCompetitors.length === 0) return "unique";

  const betterThanEveryRanked = rankedCompetitors.every(
    (position) => input.basePosition! < position,
  );
  const worseThanEveryRanked = rankedCompetitors.every(
    (position) => input.basePosition! > position,
  );

  if (betterThanEveryRanked) return "strong";
  if (worseThanEveryRanked) return "weak";
  return "shared";
}

export function keywordMatchesTerms(
  keyword: string,
  include: string[],
  exclude: string[],
) {
  const haystack = keyword.toLowerCase();
  if (
    include.length > 0 &&
    !include.every((term) => haystack.includes(term.toLowerCase()))
  ) {
    return false;
  }
  return !exclude.some((term) => haystack.includes(term.toLowerCase()));
}

export function parseGapFilterTerms(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/[,+\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function buildGapFingerprint(parts: {
  baseDomain: string;
  competitorDomains: string[];
  locationCode?: number;
  languageCode?: string;
  includeSubdomains?: boolean;
}) {
  const competitors = parts.competitorDomains.toSorted((a, b) =>
    a.localeCompare(b),
  );
  return [
    parts.baseDomain,
    competitors.join(","),
    parts.locationCode ?? "",
    parts.languageCode ?? "",
    parts.includeSubdomains === false ? "0" : "1",
  ].join("|");
}
