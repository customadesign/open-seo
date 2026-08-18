import {
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  applyBillingMarkupUsd,
  roundUsdForBilling,
} from "./billing";

// Provider list, conservative cost estimates and prompt defaults for persisted
// AI visibility tracking. Pure and dependency-free so both the dashboard client
// and the server-side seeding path can use it.

/**
 * AI surfaces we observe. Each maps to one DataForSEO endpoint family:
 *  - chatgpt_search  -> /ai_optimization/chat_gpt/llm_responses/live
 *                       (web_search on: the searching ChatGPT, not the offline
 *                       model — otherwise the answer reflects training data,
 *                       not how the brand surfaces in AI search today)
 *  - gemini          -> /ai_optimization/gemini/llm_responses/live
 *  - google_ai_mode  -> /serp/google/ai_mode/live/advanced
 */
const AI_VISIBILITY_PROVIDERS = [
  "chatgpt_search",
  "gemini",
  "google_ai_mode",
] as const;

export type AiVisibilityProvider = (typeof AI_VISIBILITY_PROVIDERS)[number];

/** Providers enabled on an auto-seeded project config. */
export const DEFAULT_AI_VISIBILITY_PROVIDERS: readonly AiVisibilityProvider[] =
  AI_VISIBILITY_PROVIDERS;

/** Keep one baseline bounded even if a hand-written/imported config is large. */
export const MAX_PROMPTS_PER_CONFIG = 50;

/**
 * Conservative per-answer raw provider costs used for approval ceilings. The
 * actual charge always comes from the DataForSEO billing envelope; these values
 * only prevent a run from starting when its worst-case estimate is over the
 * stored ceiling.
 */
const PROVIDER_COST_USD: Record<AiVisibilityProvider, number> = {
  chatgpt_search: 0.02,
  gemini: 0.02,
  google_ai_mode: 0.01,
};

export function estimateAiVisibilityRunCredits(input: {
  promptCount: number;
  providers: readonly AiVisibilityProvider[];
}): { observations: number; costUsd: number; costCredits: number } {
  let costUsd = 0;
  let costCredits = 0;

  // Metering rounds and ceilings each provider call independently. Accumulate
  // per call so the approval ceiling cannot be understated by rounding once at
  // the end of a run.
  for (const provider of input.providers) {
    for (let index = 0; index < input.promptCount; index += 1) {
      const callCostUsd = applyBillingMarkupUsd(PROVIDER_COST_USD[provider]);
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

/** Maximum length of one tracked prompt. */
const MAX_AI_VISIBILITY_PROMPT_LENGTH = 500;

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
