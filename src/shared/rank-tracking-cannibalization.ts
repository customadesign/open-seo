import { normalizeRankingUrl } from "@/shared/rank-tracking-reports";

/**
 * Cannibalization detection for stored rank snapshots.
 *
 * What a snapshot stores
 * ----------------------
 * Each completed check writes one row per keyword per device: the *best*
 * organic URL for the tracked domain and its position. The rest of the SERP is
 * discarded. Same-SERP multi-URL cannibalization (two project URLs on one
 * results page) therefore cannot be observed from stored data.
 *
 * Rule
 * ----
 * A keyword+device is cannibalizing when both:
 *   1. two or more distinct ranking URLs appear across completed snapshots
 *      (null / unranked rows are ignored), and
 *   2. the ranking URL changed more than once (transition count ≥ 2).
 *
 * A single one-way change (A, A, B, B) is a legitimate URL change — redirect,
 * page move, or canonical swap — and is not reported.
 *
 * URL identity ignores protocol, `www.`, trailing slash, query string, and
 * fragment so a redirect target matches the URL it replaced.
 */

export type CannibalizationSnapshot = {
  checkedAt: string;
  url: string | null;
  position: number | null;
};

export type CannibalizationUrlStat = {
  url: string;
  snapshotCount: number;
};

export type CannibalizationFinding = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  competingUrls: CannibalizationUrlStat[];
  transitionCount: number;
  currentUrl: string | null;
  currentPosition: number | null;
};

export type CannibalizationKeyword = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  snapshots: readonly CannibalizationSnapshot[];
};

type RankingAppearance = {
  url: string;
  normalized: string;
  position: number | null;
  checkedAt: string;
};

function rankingAppearances(
  snapshots: readonly CannibalizationSnapshot[],
): RankingAppearance[] {
  const appearances: RankingAppearance[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.position == null || snapshot.url == null) continue;
    const normalized = normalizeRankingUrl(snapshot.url);
    if (normalized.length === 0) continue;
    appearances.push({
      url: snapshot.url,
      normalized,
      position: snapshot.position,
      checkedAt: snapshot.checkedAt,
    });
  }
  return appearances.toSorted((a, b) =>
    a.checkedAt < b.checkedAt ? -1 : a.checkedAt > b.checkedAt ? 1 : 0,
  );
}

function transitionCount(appearances: readonly RankingAppearance[]): number {
  let changes = 0;
  for (let i = 1; i < appearances.length; i += 1) {
    if (appearances[i].normalized !== appearances[i - 1].normalized) {
      changes += 1;
    }
  }
  return changes;
}

function urlStats(
  appearances: readonly RankingAppearance[],
): CannibalizationUrlStat[] {
  const counts = new Map<string, { url: string; snapshotCount: number }>();
  for (const appearance of appearances) {
    const existing = counts.get(appearance.normalized);
    if (existing) {
      existing.snapshotCount += 1;
    } else {
      counts.set(appearance.normalized, {
        url: appearance.url,
        snapshotCount: 1,
      });
    }
  }
  return [...counts.values()].toSorted(
    (a, b) => b.snapshotCount - a.snapshotCount,
  );
}

export function detectKeywordCannibalization(
  input: CannibalizationKeyword,
): CannibalizationFinding | null {
  const appearances = rankingAppearances(input.snapshots);
  const competingUrls = urlStats(appearances);
  const changes = transitionCount(appearances);
  if (competingUrls.length < 2 || changes < 2) return null;

  const latest = appearances[appearances.length - 1];
  return {
    trackingKeywordId: input.trackingKeywordId,
    keyword: input.keyword,
    device: input.device,
    competingUrls,
    transitionCount: changes,
    currentUrl: latest?.url ?? null,
    currentPosition: latest?.position ?? null,
  };
}

export function detectCannibalization(
  keywords: readonly CannibalizationKeyword[],
): CannibalizationFinding[] {
  const findings: CannibalizationFinding[] = [];
  for (const keyword of keywords) {
    const finding = detectKeywordCannibalization(keyword);
    if (finding) findings.push(finding);
  }
  return findings.toSorted((a, b) => {
    if (b.competingUrls.length !== a.competingUrls.length) {
      return b.competingUrls.length - a.competingUrls.length;
    }
    if (b.transitionCount !== a.transitionCount) {
      return b.transitionCount - a.transitionCount;
    }
    return a.keyword.localeCompare(b.keyword);
  });
}
