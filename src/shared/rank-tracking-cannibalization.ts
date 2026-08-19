import { normalizeRankingUrl } from "@/shared/rank-tracking-reports";

/**
 * Cannibalization detection.
 *
 * Same-SERP (primary)
 * -------------------
 * Two or more distinct tracked-domain organic URLs on one captured SERP.
 * This is the SEMrush meaning. It requires rank_serp_entries owned rows.
 *
 * URL flip over time (secondary)
 * ------------------------------
 * A keyword+device whose *best* ranking URL changed more than once across
 * snapshots. A single one-way change (A, A, B, B) is a redirect / page move
 * and is not reported. Pre-capture snapshots only stored one URL, so this
 * remains the fallback signal.
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

export type SameSerpUrl = {
  url: string;
  position: number;
};

export type SameSerpFinding = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  urls: SameSerpUrl[];
  currentPosition: number | null;
};

export type SameSerpKeyword = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  urls: readonly SameSerpUrl[];
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

export function detectSameSerpCannibalization(
  input: SameSerpKeyword,
): SameSerpFinding | null {
  const distinct = new Map<string, SameSerpUrl>();
  for (const row of input.urls) {
    const identity = normalizeRankingUrl(row.url);
    if (identity.length === 0) continue;
    const existing = distinct.get(identity);
    if (!existing || row.position < existing.position) {
      distinct.set(identity, { url: row.url, position: row.position });
    }
  }
  if (distinct.size < 2) return null;
  const urls = [...distinct.values()].toSorted(
    (a, b) => a.position - b.position,
  );
  return {
    trackingKeywordId: input.trackingKeywordId,
    keyword: input.keyword,
    device: input.device,
    urls,
    currentPosition: urls[0]?.position ?? null,
  };
}

export function detectSameSerpFindings(
  keywords: readonly SameSerpKeyword[],
): SameSerpFinding[] {
  const findings: SameSerpFinding[] = [];
  for (const keyword of keywords) {
    const finding = detectSameSerpCannibalization(keyword);
    if (finding) findings.push(finding);
  }
  return findings.toSorted((a, b) => {
    if (b.urls.length !== a.urls.length) return b.urls.length - a.urls.length;
    return a.keyword.localeCompare(b.keyword);
  });
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
