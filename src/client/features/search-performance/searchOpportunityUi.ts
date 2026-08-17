import type { getSearchOpportunities } from "@/serverFunctions/searchOpportunities";

export type SearchOpportunityResult = Awaited<
  ReturnType<typeof getSearchOpportunities>
>;
export type SearchOpportunityReport = Extract<
  SearchOpportunityResult,
  { status: "ok" }
>;
export type SearchOpportunityRow = SearchOpportunityReport["rows"][number];

/** GA4 engagement below this reads as "the page does not hold organic visitors",
 *  which outranks a ranking fix: more traffic to a weak page wastes the gain. */
const LOW_ENGAGEMENT_RATE = 0.4;
/** Page-one positions, where the snippet — not the ranking — is the lever. */
const PAGE_ONE_MAX_POSITION = 10;
/** Page-one click-through below this points at the title and description. */
const LOW_PAGE_ONE_CTR = 0.02;

type OpportunityAction = { label: string; detail: string };

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function businessValueLabel(metric: string): string {
  return metric === "engagementRate" ? "engagement rate" : "key-event rate";
}

/**
 * The single next step for one opportunity, in priority order: a page GA4 never
 * saw cannot be trusted, a page visitors abandon should be fixed before it is
 * promoted, a page below the first results needs depth, and a page-one page
 * that nobody clicks needs a better snippet.
 */
export function opportunityNextAction(
  row: SearchOpportunityRow,
): OpportunityAction {
  if (!row.ga4) {
    return {
      label: "Confirm analytics coverage",
      detail:
        "Search Console reports this page but no GA4 organic landing page matched it. Check tracking, redirects, or the canonical URL before acting on it.",
    };
  }
  if (row.ga4.engagementRate < LOW_ENGAGEMENT_RATE) {
    return {
      label: "Fix the landing page experience",
      detail: `Only ${formatPercent(row.ga4.engagementRate)} of organic sessions engage, so a ranking gain would send more visitors to a page that loses them.`,
    };
  }
  if (row.position > PAGE_ONE_MAX_POSITION) {
    return {
      label: "Strengthen the page and its internal links",
      detail: `It averages position ${row.position.toFixed(1)}, so content depth and internal links move it further than snippet edits.`,
    };
  }
  if (row.ctr < LOW_PAGE_ONE_CTR) {
    return {
      label: "Rewrite the title and meta description",
      detail: `It already ranks on page one but only ${(row.ctr * 100).toFixed(1)}% of impressions click, so the snippet is losing the visit.`,
    };
  }
  return {
    label: "Expand the page for the queries it already ranks for",
    detail:
      "It ranks on page one, earns clicks, and engages visitors. Add coverage for its nearby queries to widen the same page.",
  };
}

/**
 * Why the service gave this row its score, in the service's own terms. The
 * components are percentile ranks across the matched pages in this window, so
 * they are only meaningful next to the other rows in the same response.
 */
export function opportunityScoreReasons(
  row: SearchOpportunityRow,
  businessValueMetric: string,
): string[] {
  if (!row.scoreComponents) {
    return [
      "Not scored: no GA4 organic landing page matched this URL, so business value is unknown.",
    ];
  }
  return [
    `Demand ${formatPercent(row.scoreComponents.demand)} — impressions against the other matched pages`,
    `Business value ${formatPercent(row.scoreComponents.businessValue)} — ${businessValueLabel(businessValueMetric)}`,
    `Reachability ${formatPercent(row.scoreComponents.reachability)} — average position ${row.position.toFixed(1)}`,
  ];
}

export const OPPORTUNITY_MATCH_FILTERS = [
  "all",
  "matched",
  "unmatched",
] as const;
export type OpportunityMatchFilter = (typeof OPPORTUNITY_MATCH_FILTERS)[number];

/** Page or ranking-query substring match, plus the GA4 join filter. */
export function filterOpportunityRows(
  rows: SearchOpportunityRow[],
  options: { match: OpportunityMatchFilter; search: string },
): SearchOpportunityRow[] {
  const needle = options.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (options.match === "matched" && row.joinStatus !== "joined")
      return false;
    if (options.match === "unmatched" && row.joinStatus === "joined") {
      return false;
    }
    if (!needle) return true;
    return (
      row.page.toLowerCase().includes(needle) ||
      row.topQueries.some((entry) => entry.query.toLowerCase().includes(needle))
    );
  });
}
