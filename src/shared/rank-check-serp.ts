import { normalizeRankingUrl } from "@/shared/rank-tracking-reports";

/** Organic competitor domains stored per keyword/device/check. */
export const RANK_SERP_COMPETITOR_LIMIT = 10;

export type RankSerpItem = {
  type: string;
  rank_group?: number | null;
  rank_absolute?: number | null;
  domain?: string | null;
  url?: string | null;
};

export type RankOwnedUrl = {
  url: string;
  position: number;
};

export type RankCompetitorDomain = {
  domain: string;
  position: number;
};

export type RankFeatureOwnership = {
  type: string;
  owned: boolean;
};

export type RankCheckSerpCapture = {
  position: number | null;
  url: string | null;
  serpFeatures: string[];
  ownedUrls: RankOwnedUrl[];
  competitors: RankCompetitorDomain[];
  featureOwnership: RankFeatureOwnership[];
};

export function normalizeSerpDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

export function matchesTrackedDomain(
  domain: string | null | undefined,
  targetDomain: string,
): boolean {
  if (domain == null || domain.length === 0) return false;
  const value = normalizeSerpDomain(domain);
  const target = normalizeSerpDomain(targetDomain);
  return value === target || value.endsWith(`.${target}`);
}

function domainFromUrl(url: string | null | undefined): string | null {
  if (url == null || url.length === 0) return null;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function organicPosition(item: RankSerpItem): number | null {
  const position = item.rank_group ?? item.rank_absolute ?? null;
  return position != null && position >= 1 ? position : null;
}

function itemMatchesTrackedDomain(
  item: RankSerpItem,
  targetDomain: string,
): boolean {
  return (
    matchesTrackedDomain(item.domain, targetDomain) ||
    matchesTrackedDomain(domainFromUrl(item.url), targetDomain)
  );
}

/**
 * Pull owned URLs, top competitor domains, and feature ownership out of a
 * SERP that the rank check already fetched. Does not call a provider.
 */
export function captureRankCheckSerp(
  items: readonly RankSerpItem[],
  targetDomain: string,
): RankCheckSerpCapture {
  const ownedByIdentity = new Map<string, RankOwnedUrl>();
  const competitorByDomain = new Map<string, RankCompetitorDomain>();
  const featureOwned = new Map<string, boolean>();

  for (const item of items) {
    if (!item.type) continue;
    if (item.type !== "organic") {
      const alreadyOwned = featureOwned.get(item.type) === true;
      featureOwned.set(
        item.type,
        alreadyOwned || itemMatchesTrackedDomain(item, targetDomain),
      );
    }

    if (item.type !== "organic") continue;
    const position = organicPosition(item);
    if (position == null) continue;

    if (itemMatchesTrackedDomain(item, targetDomain)) {
      if (item.url == null || item.url.length === 0) continue;
      const identity = normalizeRankingUrl(item.url);
      if (identity.length === 0) continue;
      const existing = ownedByIdentity.get(identity);
      if (!existing || position < existing.position) {
        ownedByIdentity.set(identity, { url: item.url, position });
      }
      continue;
    }

    if (item.domain == null || item.domain.length === 0) continue;
    const domain = normalizeSerpDomain(item.domain);
    if (domain.length === 0) continue;
    const existing = competitorByDomain.get(domain);
    if (!existing || position < existing.position) {
      competitorByDomain.set(domain, { domain, position });
    }
  }

  const ownedUrls = [...ownedByIdentity.values()].toSorted(
    (a, b) => a.position - b.position,
  );
  const competitors = [...competitorByDomain.values()]
    .toSorted((a, b) => a.position - b.position)
    .slice(0, RANK_SERP_COMPETITOR_LIMIT);
  const best = ownedUrls[0] ?? null;

  return {
    position: best?.position ?? null,
    url: best?.url ?? null,
    serpFeatures: [...new Set(items.map((item) => item.type).filter(Boolean))],
    ownedUrls,
    competitors,
    featureOwnership: [...featureOwned.entries()]
      .map(([type, owned]) => ({ type, owned }))
      .toSorted((a, b) => a.type.localeCompare(b.type)),
  };
}
