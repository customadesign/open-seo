import type { RankTrackingSkipReason } from "@/shared/rank-tracking";

// Keyed loosely so an unknown value from an older deployment can be looked up
// without a cast; `satisfies` still forces every known reason to have a label.
const SKIP_REASON_LABELS: Record<string, string | undefined> = {
  plan_required: "paid plan required",
  no_keywords: "no keywords tracked",
  insufficient_credits: "insufficient credits",
  cost_ceiling: "estimate above the approved per-check credit ceiling",
} satisfies Record<RankTrackingSkipReason, string>;

/**
 * `last_skip_reason` is free-form text in the schema, so a row can hold a value
 * this build has no label for. Return null rather than showing a raw key.
 */
export function rankTrackingSkipReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return SKIP_REASON_LABELS[reason] ?? null;
}
