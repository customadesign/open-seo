import {
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  applyBillingMarkupUsd,
  roundUsdForBilling,
} from "./billing";

/** DataForSEO live backlinks task list price (summary, anchors, timeseries). */
export const BACKLINKS_LIVE_TASK_USD = 0.02;

/** DataForSEO bulk backlinks task list price (up to 1000 targets per call). */
export const BACKLINKS_BULK_TASK_USD = 0.02006;

/** DataForSEO Labs Google bulk traffic estimation list price. */
export const LABS_BULK_TRAFFIC_TASK_USD = 0.0101;

export const MAX_BACKLINKS_BULK_TARGETS = 200;
export const MAX_BACKLINKS_COMPETITORS = 3;

/**
 * Flag a commercial/keyword anchor when it accounts for this share or more of
 * the fetched backlink total. Brand, URL, and generic anchors are ignored.
 */
export const COMMERCIAL_ANCHOR_SHARE_THRESHOLD = 0.15;

const GENERIC_ANCHOR_LABELS = new Set([
  "click here",
  "here",
  "read more",
  "learn more",
  "website",
  "this",
  "this site",
  "this page",
  "homepage",
  "home",
  "link",
  "more",
  "source",
  "article",
  "visit",
  "view",
]);

export type AnchorKind = "empty" | "naked" | "generic" | "brand" | "commercial";

export function classifyAnchorText(
  anchor: string | null | undefined,
  target: string,
): AnchorKind {
  const normalized = normalizeAnchorLabel(anchor);
  if (!normalized) return "empty";
  if (looksLikeUrlAnchor(normalized)) return "naked";
  if (GENERIC_ANCHOR_LABELS.has(normalized)) return "generic";
  if (containsBrandToken(normalized, target)) return "brand";
  return "commercial";
}

export function estimateBacklinksBulkCredits() {
  const ranks = estimateMeteredCallCredits(BACKLINKS_BULK_TASK_USD);
  const backlinks = estimateMeteredCallCredits(BACKLINKS_BULK_TASK_USD);
  const referringDomains = estimateMeteredCallCredits(BACKLINKS_BULK_TASK_USD);
  const traffic = estimateMeteredCallCredits(LABS_BULK_TRAFFIC_TASK_USD);

  return {
    costUsd: roundUsdForBilling(
      ranks.costUsd +
        backlinks.costUsd +
        referringDomains.costUsd +
        traffic.costUsd,
    ),
    costCredits:
      ranks.costCredits +
      backlinks.costCredits +
      referringDomains.costCredits +
      traffic.costCredits,
    billedTargetLimit: MAX_BACKLINKS_BULK_TARGETS,
    calls: 4,
  };
}

export function backlinksBulkCostApprovalError(
  costCredits: number,
  maxCostCredits: number,
) {
  return `This backlinks bulk analysis costs ${costCredits} credits, above the approved maximum of ${maxCostCredits}. Call estimate_backlinks_bulk_analysis again and ask the user to approve the updated amount.`;
}

export function backlinksBulkApprovalRequiredError(costCredits: number) {
  return `This backlinks bulk analysis costs an estimated ${costCredits} credits. Call estimate_backlinks_bulk_analysis, show the estimate, then retry with maxCostCredits set to the approved amount.`;
}

export function backlinksCompetitorCostApprovalError(
  costCredits: number,
  maxCostCredits: number,
) {
  return `This competitor comparison costs ${costCredits} credits, above the approved maximum of ${maxCostCredits}. Re-estimate and approve the updated amount before running it.`;
}

export function backlinksCompetitorApprovalRequiredError(costCredits: number) {
  return `This competitor comparison costs an estimated ${costCredits} credits. Review the estimate, then retry with maxCostCredits set to the approved amount.`;
}

function estimateMeteredCallCredits(rawUsd: number) {
  const costUsd = applyBillingMarkupUsd(rawUsd);
  return {
    costUsd,
    costCredits: Math.ceil(costUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD),
  };
}

function normalizeAnchorLabel(anchor: string | null | undefined) {
  return (anchor ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeUrlAnchor(normalized: string) {
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("www.") ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|$)/.test(normalized)
  );
}

function containsBrandToken(normalized: string, target: string) {
  const hostname = target
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!hostname) return false;

  const tokens = hostname
    .split(".")
    .filter((token) => token.length >= 3 && token !== "www" && token !== "com");
  return tokens.some((token) => normalized.includes(token));
}
