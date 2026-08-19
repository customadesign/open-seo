import {
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  applyBillingMarkupUsd,
  roundUsdForBilling,
} from "./billing";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * AI surfaces we observe. Each maps to one DataForSEO queued endpoint family:
 *  - chatgpt_search  -> /ai_optimization/chat_gpt/llm_scraper/task_post
 *                       (force_web_search: the searching ChatGPT, not the
 *                       offline model)
 *  - gemini          -> /ai_optimization/gemini/llm_responses/task_post
 *  - google_ai_mode  -> /serp/google/ai_mode/task_post
 */
export const AI_VISIBILITY_PROVIDERS = [
  "chatgpt_search",
  "gemini",
  "google_ai_mode",
] as const;

export type AiVisibilityProvider = (typeof AI_VISIBILITY_PROVIDERS)[number];

export function isAiVisibilityProvider(
  value: string,
): value is AiVisibilityProvider {
  return (AI_VISIBILITY_PROVIDERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Hard cap on prompts per config. A run costs prompts × enabled providers
 * upstream calls, so this is the primary brake on a single run's spend.
 */
export const MAX_PROMPTS_PER_CONFIG = 50;

/** Maximum length of one tracked prompt. */
export const MAX_AI_VISIBILITY_PROMPT_LENGTH = 500;

/** Maximum configs per project. */
export const MAX_AI_VISIBILITY_CONFIGS_PER_PROJECT = 25;

/** Maximum queued tasks DataForSEO accepts in one task_post. */
export const MAX_AI_VISIBILITY_TASKS_PER_POST = 100;

// Values written to ai_visibility_configs.last_skip_reason.
export type AiVisibilitySkipReason =
  | "plan_required"
  | "no_prompts"
  | "no_providers"
  | "insufficient_credits"
  | "cost_ceiling";

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Per-observation DataForSEO cost used ONLY to size the pre-run estimate and
 * the approval ceiling.
 *
 * These are deliberately conservative upper bounds, not a published price
 * card: the estimate may ask a user to approve more than a run ends up
 * spending, and must never do the reverse. Real spend is always taken from the
 * DataForSEO billing envelope at metering time and written to
 * ai_visibility_runs.cost_usd / ai_visibility_observations.cost_usd.
 *
 * Verify and tighten these against live invoices with:
 *   pnpm billing:ai-visibility -- --confirmLive=true
 */
const PROVIDER_COST_USD: Record<AiVisibilityProvider, number> = {
  chatgpt_search: 0.02,
  gemini: 0.02,
  google_ai_mode: 0.01,
};

export function providerCostUsd(provider: AiVisibilityProvider): number {
  return PROVIDER_COST_USD[provider];
}

/**
 * Estimate one run: every active prompt asked of every enabled provider.
 *
 * Metering rounds and ceilings each provider call independently, so credits
 * are accumulated per call rather than rounded once over the total — summing
 * first would understate what is actually charged.
 */
export function estimateAiVisibilityRunCredits(input: {
  promptCount: number;
  providers: readonly AiVisibilityProvider[];
}): { observations: number; costUsd: number; costCredits: number } {
  let costUsd = 0;
  let costCredits = 0;

  for (const provider of input.providers) {
    for (let index = 0; index < input.promptCount; index += 1) {
      const callCostUsd = applyBillingMarkupUsd(providerCostUsd(provider));
      costUsd += callCostUsd;
      costCredits += Math.ceil(callCostUsd * AUTUMN_SEO_DATA_CREDITS_PER_USD);
    }
  }

  return {
    observations: input.promptCount * input.providers.length,
    costUsd: roundUsdForBilling(costUsd),
    costCredits,
  };
}

export const aiVisibilityCostApprovalError = (
  costCredits: number,
  maxCostCredits: number,
) =>
  `This AI visibility run costs ${costCredits} credits, above the approved maximum of ${maxCostCredits}. Re-estimate the run and ask the user to approve the updated amount.`;

export const aiVisibilityPromptLimitError = (requested: number) =>
  `A config can track at most ${MAX_PROMPTS_PER_CONFIG} prompts (requested ${requested}).`;

// ---------------------------------------------------------------------------
// Auto-seeded baseline configs
// ---------------------------------------------------------------------------

/** Providers enabled on an auto-seeded project config. */
export const DEFAULT_AI_VISIBILITY_PROVIDERS: readonly AiVisibilityProvider[] =
  AI_VISIBILITY_PROVIDERS;

/**
 * Baseline prompts for a newly seeded config. Deliberately few: a run costs
 * prompts × providers metered upstream calls, and the dashboard only needs a
 * stable mention baseline, not prompt-level coverage.
 */
export function buildDefaultAiVisibilityPrompts(brandName: string): string[] {
  const brand = brandName.trim();
  if (!brand) return [];
  return [
    `What is ${brand}?`,
    `What do people say about ${brand}?`,
    `What are the best alternatives to ${brand}?`,
  ].map((prompt) => prompt.slice(0, MAX_AI_VISIBILITY_PROMPT_LENGTH));
}

/**
 * Brand string for a project. The project name is what a user would type into
 * an AI assistant; the domain's registrable label is the fallback when a
 * project was never named.
 */
export function deriveBrandName(input: {
  projectName: string | null;
  domain: string | null;
}): string | null {
  const name = input.projectName?.trim();
  if (name) return name;
  const host = input.domain
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!host) return null;
  const label = host.split(".")[0];
  return label.length > 0 ? label : null;
}
