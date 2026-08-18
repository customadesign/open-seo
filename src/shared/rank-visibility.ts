// Pure visibility maths, shared by the rank-tracking scorecards (client) and
// the project dashboard (server). Lives in `src/shared` so the server can score
// rank snapshots without importing a client feature module.

// Approximate organic CTR by position (index = position; aggregate industry
// curves). Only used to weight the visibility metric, so relative weights
// matter, not exact values. Positions past the list fall back to a small CTR.
const CTR_BY_POSITION = [
  0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.033, 0.028, 0.024, 0.021, 0.018,
  0.016, 0.014, 0.012, 0.011, 0.01, 0.009, 0.008, 0.007, 0.006,
];
const TOP_CTR = CTR_BY_POSITION[1];

function positionCtr(position: number | null): number {
  if (position === null || position < 1) return 0;
  return CTR_BY_POSITION[position] ?? 0.005;
}

export interface VisibilityEntry {
  searchVolume: number | null;
  position: number | null;
  previousPosition: number | null;
}

interface VisibilityScore {
  /**
   * Volume-weighted, CTR-weighted share of click potential captured (0–100):
   * Σ(volume × CTR@position) ÷ Σ(volume × CTR@1). null if no volume data.
   */
  current: number | null;
  previous: number | null;
  /** Change in percentage points, null when either side is unknown. */
  delta: number | null;
}

/**
 * Score a set of (volume, position, previousPosition) entries. Keywords with no
 * known search volume are excluded from both numerator and denominator: they
 * carry no click potential to weight, and counting them as zero volume would
 * silently understate the score.
 *
 * Entries may span several rank-tracking configs and both devices — the metric
 * is a ratio, so adding more entries averages them by volume rather than
 * inflating the result.
 */
export function computeVisibility(
  entries: readonly VisibilityEntry[],
): VisibilityScore {
  let volume = 0;
  let numeratorCurrent = 0;
  let numeratorPrevious = 0;

  for (const entry of entries) {
    if (entry.searchVolume == null || entry.searchVolume <= 0) continue;
    volume += entry.searchVolume;
    numeratorCurrent += entry.searchVolume * positionCtr(entry.position);
    numeratorPrevious +=
      entry.searchVolume * positionCtr(entry.previousPosition);
  }

  if (volume <= 0) return { current: null, previous: null, delta: null };

  const current = (numeratorCurrent / (volume * TOP_CTR)) * 100;
  const previous = (numeratorPrevious / (volume * TOP_CTR)) * 100;
  return { current, previous, delta: current - previous };
}
