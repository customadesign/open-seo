import {
  applyBillingMarkupUsd,
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  roundUsdForBilling,
} from "./billing";

/**
 * Keyword Magic match-type views. Each rule is applied to the persisted
 * result set (free). They do not re-query the provider.
 *
 * All — no match-type predicate; every persisted keyword.
 *
 * Broad Match — every seed token appears in the keyword, in any order.
 *   Seed "best crm" matches "crm software best" and "best crm for startups".
 *   Mapped from Labs `keyword_suggestions` with `exact_match: false`.
 *
 * Phrase Match — the seed appears as a contiguous token sequence.
 *   Seed "best crm" matches "best crm software", not "crm best software".
 *   Mapped from Labs `keyword_suggestions` with `exact_match: true`, and
 *   also applied as a local filter so Phrase is available on a Broad fetch.
 *
 * Exact Match — the keyword's token sequence equals the seed's
 *   (punctuation-insensitive). "best crm" matches "best crm" and "best-crm".
 *   No dedicated Labs endpoint; this is a local filter over suggestions.
 *
 * Related — the keyword does NOT contain every seed token (not Broad).
 *   These typically come from Labs `related_keywords` / `keyword_ideas`.
 *
 * Questions — the keyword is a question: it contains "?" or its first token
 *   is a question word (who/what/where/when/why/how/which/whom/whose/can/
 *   could/do/does/did/is/are/was/were/will/would/should/shall/may/might).
 *   No dedicated Labs endpoint; local filter over the union.
 */
export const KEYWORD_MAGIC_MATCH_TYPES = [
  "all",
  "broad",
  "phrase",
  "exact",
  "related",
  "questions",
] as const;

export type KeywordMagicMatchType = (typeof KEYWORD_MAGIC_MATCH_TYPES)[number];

export const KEYWORD_MAGIC_MATCH_TYPE_LABELS: Record<
  KeywordMagicMatchType,
  string
> = {
  all: "All",
  broad: "Broad Match",
  phrase: "Phrase Match",
  exact: "Exact Match",
  related: "Related",
  questions: "Questions",
};

export const KEYWORD_MAGIC_CACHE_VERSION = 1;
export const KEYWORD_MAGIC_TTL_MS = 12 * 60 * 60 * 1000;
export const KEYWORD_MAGIC_PROVIDER_PAGE_SIZE = 1000;
export const KEYWORD_MAGIC_MAX_KEYWORDS = 20_000;
export const KEYWORD_MAGIC_DEFAULT_KEYWORDS = 10_000;
export const KEYWORD_MAGIC_SCALE_OPTIONS = [
  1_000, 5_000, 10_000, 20_000,
] as const;
export type KeywordMagicScale = (typeof KEYWORD_MAGIC_SCALE_OPTIONS)[number];

export const KEYWORD_MAGIC_MAX_CLUSTERS = 50;

export const KEYWORD_MAGIC_PAGE_SIZES = [50, 100, 300, 500] as const;
export type KeywordMagicPageSize = (typeof KEYWORD_MAGIC_PAGE_SIZES)[number];

/**
 * Conservative per-request upper bound for Labs keyword_suggestions /
 * keyword_ideas / related_keywords. Real spend is taken from the DataForSEO
 * billing envelope. Clickstream doubles the request. Verify against invoices
 * if this starts over- or under-asking.
 */
const LABS_KEYWORD_REQUEST_USD = 0.02;

/** Google Ads keywords_for_keywords is a single request; ~$0.075 raw in practice. */
const ADS_KEYWORD_REQUEST_USD = 0.08;

export function isKeywordMagicScale(value: number): value is KeywordMagicScale {
  return (KEYWORD_MAGIC_SCALE_OPTIONS as readonly number[]).includes(value);
}

export function clampKeywordMagicScale(value: number): KeywordMagicScale {
  if (isKeywordMagicScale(value)) return value;
  return KEYWORD_MAGIC_DEFAULT_KEYWORDS;
}

export function keywordMagicFingerprint(input: {
  seed: string;
  locationCode: number;
  languageCode: string;
  clickstream: boolean;
  maxKeywords: number;
}): string {
  return [
    `v${KEYWORD_MAGIC_CACHE_VERSION}`,
    input.seed,
    String(input.locationCode),
    input.languageCode,
    input.clickstream ? "cs" : "ncs",
    String(input.maxKeywords),
  ].join("|");
}

export function estimateKeywordMagicLabsRequests(maxKeywords: number): {
  suggestionPages: number;
  relatedPages: number;
  ideaPages: number;
  totalRequests: number;
} {
  const capped = Math.min(Math.max(1, maxKeywords), KEYWORD_MAGIC_MAX_KEYWORDS);
  const suggestionPages = Math.max(
    1,
    Math.ceil(capped / KEYWORD_MAGIC_PROVIDER_PAGE_SIZE),
  );
  // One related page and one ideas page enrich the set; they are cheap
  // relative to suggestion fan-out and fill Related / leftover topics.
  const relatedPages = 1;
  const ideaPages = 1;
  return {
    suggestionPages,
    relatedPages,
    ideaPages,
    totalRequests: suggestionPages + relatedPages + ideaPages,
  };
}

export function estimateKeywordMagicRunCredits(input: {
  maxKeywords: number;
  clickstream: boolean;
  provider: "labs" | "google_ads";
  hosted: boolean;
}): { requests: number; costUsd: number; costCredits: number } {
  if (input.provider === "google_ads") {
    const rawUsd = ADS_KEYWORD_REQUEST_USD;
    const billedUsd = input.hosted ? applyBillingMarkupUsd(rawUsd) : rawUsd;
    const costCredits = Math.ceil(billedUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD);
    return {
      requests: 1,
      costUsd: input.hosted
        ? roundUsdForBilling(costCredits / AUTUMN_SEO_DATA_CREDITS_PER_USD)
        : roundUsdForBilling(rawUsd),
      costCredits,
    };
  }

  const { totalRequests } = estimateKeywordMagicLabsRequests(input.maxKeywords);
  const perRequestRaw = input.clickstream
    ? LABS_KEYWORD_REQUEST_USD * 2
    : LABS_KEYWORD_REQUEST_USD;

  let costUsd = 0;
  let costCredits = 0;
  for (let index = 0; index < totalRequests; index += 1) {
    const billedUsd = input.hosted
      ? applyBillingMarkupUsd(perRequestRaw)
      : perRequestRaw;
    costUsd += billedUsd;
    costCredits += Math.ceil(billedUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD);
  }

  return {
    requests: totalRequests,
    costUsd: roundUsdForBilling(costUsd),
    costCredits,
  };
}

export const keywordMagicCostApprovalError = (
  costCredits: number,
  maxCostCredits: number,
) =>
  `This keyword search costs ${costCredits} credits, above the approved maximum of ${maxCostCredits}. Re-estimate and approve the updated amount.`;
