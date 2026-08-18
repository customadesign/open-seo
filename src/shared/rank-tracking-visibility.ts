/**
 * Volume-weighted visibility used by the rank-tracking scorecards and the
 * per-keyword attribution report. The CTR curve is an industry approximation;
 * only relative weights matter, so both surfaces must share this module.
 */

const CTR_BY_POSITION = [
  0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.033, 0.028, 0.024, 0.021, 0.018,
  0.016, 0.014, 0.012, 0.011, 0.01, 0.009, 0.008, 0.007, 0.006,
];

export const TOP_POSITION_CTR = CTR_BY_POSITION[1];

export function ctrAtPosition(position: number | null): number {
  if (position === null || position < 1) return 0;
  return CTR_BY_POSITION[position] ?? 0.005;
}

export function estimatedTraffic(
  searchVolume: number | null,
  position: number | null,
): number | null {
  if (searchVolume == null || searchVolume <= 0) return null;
  return searchVolume * ctrAtPosition(position);
}

/**
 * Share of click potential captured: Σ(volume × CTR@position) ÷ Σ(volume ×
 * CTR@1), as a 0–100 percentage. Null when no keyword has volume.
 */
export function visibilityPercent(
  rows: ReadonlyArray<{
    searchVolume: number | null;
    position: number | null;
  }>,
): number | null {
  let numerator = 0;
  let volume = 0;
  for (const row of rows) {
    if (row.searchVolume == null || row.searchVolume <= 0) continue;
    volume += row.searchVolume;
    numerator += row.searchVolume * ctrAtPosition(row.position);
  }
  if (volume === 0) return null;
  return (numerator / (volume * TOP_POSITION_CTR)) * 100;
}

export type VisibilityContribution = {
  trackingKeywordId: string;
  keyword: string;
  searchVolume: number;
  position: number | null;
  previousPosition: number | null;
  /** Percentage-point contribution to the overall visibility change. */
  contribution: number;
};

/**
 * Per-keyword contribution to the change in overall visibility between two
 * snapshots. Keywords without volume are omitted. Contributions sum to the
 * same visibility delta `visibilityPercent` would report.
 */
export function visibilityContributions(
  rows: ReadonlyArray<{
    trackingKeywordId: string;
    keyword: string;
    searchVolume: number | null;
    position: number | null;
    previousPosition: number | null;
  }>,
): VisibilityContribution[] {
  let volume = 0;
  const eligible: Array<{
    trackingKeywordId: string;
    keyword: string;
    searchVolume: number;
    position: number | null;
    previousPosition: number | null;
  }> = [];

  for (const row of rows) {
    if (row.searchVolume == null || row.searchVolume <= 0) continue;
    volume += row.searchVolume;
    eligible.push({
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      position: row.position,
      previousPosition: row.previousPosition,
    });
  }

  if (volume === 0) return [];

  const denominator = volume * TOP_POSITION_CTR;
  return eligible
    .map((row) => ({
      trackingKeywordId: row.trackingKeywordId,
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      position: row.position,
      previousPosition: row.previousPosition,
      contribution:
        ((row.searchVolume *
          (ctrAtPosition(row.position) - ctrAtPosition(row.previousPosition))) /
          denominator) *
        100,
    }))
    .toSorted((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function formatVisibilityContribution(
  keyword: string,
  contribution: number,
): string {
  const rounded = Math.round(contribution * 100) / 100;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${keyword} ${sign}${Math.abs(rounded).toFixed(2)}%`;
}
