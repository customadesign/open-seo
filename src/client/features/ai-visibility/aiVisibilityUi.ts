import type {
  AiVisibilityProvider,
  AiVisibilitySkipReason,
} from "@/shared/ai-visibility";

export const AI_VISIBILITY_PROVIDER_LABELS: Record<
  AiVisibilityProvider,
  string
> = {
  chatgpt_search: "ChatGPT Search",
  gemini: "Gemini",
  google_ai_mode: "Google AI Mode",
};

// Keyed loosely so an unknown value from an older deployment can be looked up
// without a cast; `satisfies` still forces every known reason to have a label.
const SKIP_REASON_LABELS: Record<string, string | undefined> = {
  plan_required: "paid plan required",
  no_prompts: "no active prompts",
  no_providers: "no providers enabled",
  insufficient_credits: "insufficient credits",
  cost_ceiling: "estimate above the per-run ceiling",
} satisfies Record<AiVisibilitySkipReason, string>;

/**
 * `last_skip_reason` is free-form text in the schema, so a row can hold a value
 * this build has no label for. Return null rather than showing a raw key.
 */
export function aiVisibilitySkipReasonLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return SKIP_REASON_LABELS[reason] ?? null;
}
