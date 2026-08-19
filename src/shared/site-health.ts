// Transparent site-health scorer: one pure function over per-page issue
// severity counts, so the number on the dashboard can always be explained from
// the audit rows that produced it.

/**
 * Penalty points per issue, by severity. `info` is deliberately 0 — an
 * informational finding is not a health defect, and weighting it would make the
 * score drift down as the audit's issue catalogue grows.
 */
const SITE_HEALTH_SEVERITY_WEIGHTS = {
  critical: 5,
  warning: 2,
  info: 0,
} as const;

/**
 * Ceiling on a single page's penalty. Without it one catastrophic page (dozens
 * of critical issues) would sink the whole score, so the metric would say more
 * about the worst page than about the site.
 */
const MAX_PAGE_PENALTY = 10;

interface PageSeverityCount {
  pageUrl: string;
  severity: keyof typeof SITE_HEALTH_SEVERITY_WEIGHTS;
  issues: number;
}

/**
 * Health as a 0–100 percentage: `100 − penalty ÷ worstCasePenalty`, where the
 * worst case is every crawled page hitting the per-page cap.
 *
 * Returns null when nothing was crawled — an audit with no pages has no health
 * to report, and 0 would read as "perfectly broken".
 */
export function computeSiteHealthScore(input: {
  pagesCrawled: number;
  pageSeverityCounts: readonly PageSeverityCount[];
}): number | null {
  if (input.pagesCrawled <= 0) return null;

  const penaltyByPage = new Map<string, number>();
  for (const row of input.pageSeverityCounts) {
    const weight = SITE_HEALTH_SEVERITY_WEIGHTS[row.severity];
    if (!weight || row.issues <= 0) continue;
    penaltyByPage.set(
      row.pageUrl,
      (penaltyByPage.get(row.pageUrl) ?? 0) + weight * row.issues,
    );
  }

  let penalty = 0;
  for (const pagePenalty of penaltyByPage.values()) {
    penalty += Math.min(pagePenalty, MAX_PAGE_PENALTY);
  }

  const worstCase = MAX_PAGE_PENALTY * input.pagesCrawled;
  const score = 100 - (penalty / worstCase) * 100;
  return Math.round(Math.min(100, Math.max(0, score)));
}
