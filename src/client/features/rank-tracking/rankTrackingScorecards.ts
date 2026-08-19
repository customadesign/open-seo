import type { RankTrackingRow } from "@/types/schemas/rank-tracking";
import {
  ctrAtPosition,
  TOP_POSITION_CTR,
} from "@/shared/rank-tracking-visibility";

interface Scorecards {
  /**
   * Volume-weighted, CTR-weighted share of click potential captured (0–100):
   * Σ(volume × CTR@position) ÷ Σ(volume × CTR@1). null if no volume data.
   */
  visibility: number | null;
  /** change in visibility (percentage points) vs the comparison period */
  visibilityDelta: number | null;
  /** keywords currently ranking (found within the tracked depth) */
  ranking: number;
  /** change in ranking-keyword count vs the comparison period */
  rankingDelta: number;
  top3: number;
  top10: number;
  improved: number;
  declined: number;
}

/**
 * Portfolio scorecards from the already-loaded latest results for one device.
 * `ranking` counts keywords found within the tracked depth (a non-null
 * position) — unlike an average, it correctly drops when keywords fall out.
 * Improved/declined use the same 4-case null rules as DeviceRankCell: a "new"
 * entry counts as improved, a "lost" ranking counts as declined, and we never
 * subtract through a null.
 */
export function computeScorecards(
  rows: RankTrackingRow[],
  device: "desktop" | "mobile",
): Scorecards {
  let countCurrent = 0;
  let countPrevious = 0;
  let top3 = 0;
  let top10 = 0;
  let improved = 0;
  let declined = 0;
  let visNumCurrent = 0;
  let visNumPrevious = 0;
  let visVolume = 0; // Σ volume over keywords with known volume

  for (const row of rows) {
    const { position, previousPosition } = row[device];

    if (position !== null) {
      countCurrent += 1;
      if (position <= 3) top3 += 1;
      if (position <= 10) top10 += 1;
    }
    if (previousPosition !== null) {
      countPrevious += 1;
    }

    if (row.searchVolume != null && row.searchVolume > 0) {
      visVolume += row.searchVolume;
      visNumCurrent += row.searchVolume * ctrAtPosition(position);
      visNumPrevious += row.searchVolume * ctrAtPosition(previousPosition);
    }

    // 4-case change classification (mirrors DeviceRankCell)
    if (position === null && previousPosition === null) {
      // nothing tracked — neither improved nor declined
    } else if (position === null) {
      declined += 1; // was ranking, now lost
    } else if (previousPosition === null) {
      improved += 1; // new entry
    } else if (previousPosition - position > 0) {
      improved += 1; // moved up
    } else if (previousPosition - position < 0) {
      declined += 1; // moved down
    }
  }

  const visibility =
    visVolume > 0
      ? (visNumCurrent / (visVolume * TOP_POSITION_CTR)) * 100
      : null;
  const visibilityPrevious =
    visVolume > 0
      ? (visNumPrevious / (visVolume * TOP_POSITION_CTR)) * 100
      : null;

  return {
    visibility,
    visibilityDelta:
      visibility !== null && visibilityPrevious !== null
        ? visibility - visibilityPrevious
        : null,
    ranking: countCurrent,
    rankingDelta: countCurrent - countPrevious,
    top3,
    top10,
    improved,
    declined,
  };
}
