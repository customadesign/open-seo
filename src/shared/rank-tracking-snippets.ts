import { isNotableSerpFeature } from "@/shared/rank-tracking-reports";

export type SnippetStatus = "owned" | "available" | "lost";

export type SnippetOwnershipInput = {
  trackingKeywordId: string;
  keyword: string;
  position: number | null;
  feature: string;
  owned: boolean;
};

export type SnippetOwnershipRow = {
  trackingKeywordId: string;
  keyword: string;
  position: number | null;
  feature: string;
  status: SnippetStatus;
};

const STATUS_ORDER: Record<SnippetStatus, number> = {
  owned: 0,
  lost: 1,
  available: 2,
};

function featureKey(row: { trackingKeywordId: string; feature: string }) {
  return `${row.trackingKeywordId}:${row.feature}`;
}

/**
 * Classify notable SERP features as owned, available (present but not ours),
 * or lost (owned on the previous captured check).
 */
export function detectSnippetOwnership(
  current: readonly SnippetOwnershipInput[],
  previous: readonly SnippetOwnershipInput[],
): SnippetOwnershipRow[] {
  const previousOwned = new Map<string, SnippetOwnershipInput>();
  for (const row of previous) {
    if (!row.owned || !isNotableSerpFeature(row.feature)) continue;
    previousOwned.set(featureKey(row), row);
  }

  const seen = new Set<string>();
  const findings: SnippetOwnershipRow[] = [];

  for (const row of current) {
    if (!isNotableSerpFeature(row.feature)) continue;
    const key = featureKey(row);
    seen.add(key);
    const status: SnippetStatus = row.owned
      ? "owned"
      : previousOwned.has(key)
        ? "lost"
        : "available";
    findings.push({
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      position: row.position,
      feature: row.feature,
      status,
    });
  }

  for (const [key, row] of previousOwned) {
    if (seen.has(key)) continue;
    findings.push({
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      position: row.position,
      feature: row.feature,
      status: "lost",
    });
  }

  return findings.toSorted((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }
    if (a.feature === "featured_snippet" && b.feature !== "featured_snippet") {
      return -1;
    }
    if (b.feature === "featured_snippet" && a.feature !== "featured_snippet") {
      return 1;
    }
    if (a.feature !== b.feature) return a.feature.localeCompare(b.feature);
    return a.keyword.localeCompare(b.keyword);
  });
}
