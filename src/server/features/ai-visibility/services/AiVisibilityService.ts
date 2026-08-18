import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  checkUsageCreditsDepleted,
  customerHasPaidPlan,
  getOrCreateOrganizationCustomer,
} from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import {
  shapeObservation,
  shapeUnavailableObservation,
  summarizeAiVisibilityRun,
  type AiVisibilityRunSummary,
  type ShapedObservation,
} from "@/server/features/ai-visibility/services/aiVisibilityObservations";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  buildDefaultAiVisibilityPrompts,
  deriveBrandName,
  DEFAULT_AI_VISIBILITY_PROVIDERS,
  estimateAiVisibilityRunCredits,
  MAX_PROMPTS_PER_CONFIG,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";
import { parseDbTimestampMs } from "@/shared/db-timestamps";

// Baseline AI visibility collection for the project dashboard.
//
// The dashboard NEVER calls a provider while rendering: it reads persisted runs
// and observations. A separate refresh entry point seeds the config, opens at
// most one run per config per day, and hands back a plan the caller executes
// out of band (`waitUntil`) so a first visit is never blocked by nine live
// provider calls.
//
// Spend is metered inside the DataForSEO client (one charge per provider call,
// attributed to `ai_prompt_responses`), which unwraps the billing envelope
// before returning — so `ai_visibility_runs.cost_usd` stays 0 here. Credit
// history, not this column, is the record of what a run cost.

/** At most one baseline run per config per day. */
const RUN_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * An in-flight run older than this is treated as abandoned: the request that
 * opened it may have been evicted mid-flight, and without reclaiming the slot
 * the partial unique index would block the config forever.
 */
const RUN_STALE_AFTER_MS = 30 * 60 * 1000;

type AiVisibilitySkipReason =
  | "no_domain"
  | "not_due"
  | "already_running"
  | "plan_required"
  | "insufficient_credits"
  | "cost_ceiling";

export interface AiVisibilityRunPlan {
  runId: string;
  configId: string;
  brandName: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  prompts: Array<{ id: string; prompt: string }>;
  providers: AiVisibilityProvider[];
  maxCostCredits: number | null;
}

export interface AiVisibilityState {
  configured: boolean;
  /** A run is open right now, so the cards should read as "collecting". */
  running: boolean;
  /**
   * Why the last refresh attempt collected nothing, straight off the config —
   * so the read path can explain an empty card without re-running the billing
   * checks on every render.
   */
  skipReason: string | null;
  latest: {
    status: "completed" | "failed";
    summary: AiVisibilityRunSummary;
    capturedAt: string;
  } | null;
  previous: { summary: AiVisibilityRunSummary } | null;
}

type ProjectInput = {
  projectId: string;
  projectName: string;
  domain: string | null;
  locationCode: number;
  languageCode: string;
};

// ---------------------------------------------------------------------------
// Read path (no provider calls, no spend)
// ---------------------------------------------------------------------------

async function getState(projectId: string): Promise<AiVisibilityState> {
  const config =
    await AiVisibilityRepository.getPrimaryConfigForProject(projectId);
  if (!config) {
    return {
      configured: false,
      running: false,
      skipReason: null,
      latest: null,
      previous: null,
    };
  }

  const [activeRun, finishedRuns] = await Promise.all([
    AiVisibilityRepository.getActiveRunForConfig(config.id),
    // Include failed runs so a failed first baseline is visible as unavailable
    // instead of looking like it is still collecting forever.
    AiVisibilityRepository.getRecentFinishedRuns(config.id, 3),
  ]);

  const [latestRun] = finishedRuns;
  const previousRun = finishedRuns.find(
    (run) => run.status === "completed" && run.id !== latestRun?.id,
  );
  const observations = await AiVisibilityRepository.getObservationsForRuns(
    finishedRuns.map((run) => run.id),
  );
  const byRun = (runId: string) =>
    observations.filter((observation) => observation.runId === runId);

  return {
    configured: true,
    running: activeRun !== null,
    skipReason: config.lastSkipReason,
    latest: latestRun
      ? {
          status: latestRun.status,
          summary: summarizeAiVisibilityRun(byRun(latestRun.id)),
          capturedAt: latestRun.completedAt ?? latestRun.startedAt,
        }
      : null,
    previous: previousRun
      ? { summary: summarizeAiVisibilityRun(byRun(previousRun.id)) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Refresh path
// ---------------------------------------------------------------------------

/**
 * Idempotent seed: creates the project's config on first call and tops up the
 * default providers and prompts. Never removes a provider or prompt, so a user
 * who trimmed the defaults does not get them back on the next visit.
 */
async function ensureSeed(input: ProjectInput & { domain: string }) {
  const brandName = deriveBrandName({
    projectName: input.projectName,
    domain: input.domain,
  });
  if (!brandName) return null;

  const existing = await AiVisibilityRepository.getPrimaryConfigForProject(
    input.projectId,
  );
  if (!existing) {
    await AiVisibilityRepository.createConfig({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      brandName,
      domain: input.domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      // The dashboard's first baseline is explicitly visit-triggered. Do not
      // silently opt a new project into recurring provider spend.
      scheduleInterval: "manual",
      isActive: false,
    });
  }

  const config = await AiVisibilityRepository.getPrimaryConfigForProject(
    input.projectId,
  );
  if (!config) return null;

  // The tracked domain follows the project's domain; the brand string does not,
  // because a user may have corrected it.
  if (config.domain !== input.domain) {
    await AiVisibilityRepository.updateConfig(config.id, {
      domain: input.domain,
    });
  }

  await AiVisibilityRepository.addProviders(
    config.id,
    DEFAULT_AI_VISIBILITY_PROVIDERS,
  );
  await AiVisibilityRepository.addPrompts(
    buildDefaultAiVisibilityPrompts(config.brandName).map((prompt) => ({
      id: crypto.randomUUID(),
      configId: config.id,
      prompt,
    })),
  );

  return { ...config, domain: input.domain };
}

async function checkEligibility(
  billingCustomer: BillingCustomerContext,
): Promise<AiVisibilitySkipReason | null> {
  // Self-hosted deployments bring their own DataForSEO account: no plan or
  // credit pool to gate against.
  if (!(await isHostedServerAuthMode())) return null;

  const customer = await getOrCreateOrganizationCustomer(billingCustomer);
  if (!(await customerHasPaidPlan(customer.id))) return "plan_required";

  const { depleted } = await checkUsageCreditsDepleted(billingCustomer);
  return depleted ? "insufficient_credits" : null;
}

function isStale(timestamp: string, maxAgeMs: number): boolean {
  const ms = parseDbTimestampMs(timestamp);
  return ms === null || Date.now() - ms >= maxAgeMs;
}

/**
 * Open a baseline run when one is due, or say why not. Fast: DB reads plus the
 * billing checks only — the provider calls happen in `executeRun`.
 */
async function ensureBaselineRun(
  input: ProjectInput & { billingCustomer: BillingCustomerContext },
): Promise<
  | { queued: true; plan: AiVisibilityRunPlan }
  | { queued: false; reason: AiVisibilitySkipReason }
> {
  if (!input.domain) return { queued: false, reason: "no_domain" };

  const config = await ensureSeed({ ...input, domain: input.domain });
  if (!config) return { queued: false, reason: "no_domain" };

  const [completed, active] = await Promise.all([
    AiVisibilityRepository.getRecentCompletedRuns(config.id, 1),
    AiVisibilityRepository.getActiveRunForConfig(config.id),
  ]);

  if (completed[0] && !isStale(completed[0].startedAt, RUN_MIN_INTERVAL_MS)) {
    return { queued: false, reason: "not_due" };
  }
  if (active) {
    if (!isStale(active.startedAt, RUN_STALE_AFTER_MS)) {
      return { queued: false, reason: "already_running" };
    }
    await AiVisibilityRepository.updateRun(active.id, {
      status: "failed",
      errorMessage: "Run abandoned before completing",
      completedAt: new Date().toISOString(),
    });
  }
  // `lastRunAt` is written when a run is claimed, so a failed attempt consumes
  // the same daily baseline slot as a completed attempt. This prevents a
  // provider outage from being re-spent on every manager dashboard visit.
  if (config.lastRunAt && !isStale(config.lastRunAt, RUN_MIN_INTERVAL_MS)) {
    return { queued: false, reason: "not_due" };
  }

  const skipReason = await checkEligibility(input.billingCustomer);
  if (skipReason) {
    await AiVisibilityRepository.updateConfig(config.id, {
      lastSkipReason: skipReason,
    });
    return { queued: false, reason: skipReason };
  }

  const [prompts, providers] = await Promise.all([
    AiVisibilityRepository.getActivePromptsForConfig(config.id),
    AiVisibilityRepository.getProvidersForConfig(config.id),
  ]);
  const activePrompts = prompts.slice(0, MAX_PROMPTS_PER_CONFIG);
  if (activePrompts.length === 0 || providers.length === 0) {
    return { queued: false, reason: "not_due" };
  }

  const estimate = estimateAiVisibilityRunCredits({
    promptCount: activePrompts.length,
    providers,
  });
  if (
    config.maxCostCredits != null &&
    estimate.costCredits > config.maxCostCredits
  ) {
    await AiVisibilityRepository.updateConfig(config.id, {
      lastSkipReason: "cost_ceiling",
    });
    return { queued: false, reason: "cost_ceiling" };
  }

  const runId = crypto.randomUUID();
  const created = await AiVisibilityRepository.tryCreateRun({
    id: runId,
    configId: config.id,
    projectId: input.projectId,
    trigger: "manual",
    observationsTotal: estimate.observations,
    maxCostCredits: config.maxCostCredits ?? null,
  });
  // Lost the race against a concurrent visit; the winner's run is the one.
  if (!created) return { queued: false, reason: "already_running" };

  await AiVisibilityRepository.updateConfig(config.id, {
    lastRunAt: new Date().toISOString(),
    lastSkipReason: null,
  });

  return {
    queued: true,
    plan: {
      runId,
      configId: config.id,
      brandName: config.brandName,
      domain: config.domain,
      locationCode: config.locationCode,
      languageCode: config.languageCode,
      prompts: activePrompts.map((prompt) => ({
        id: prompt.id,
        prompt: prompt.prompt,
      })),
      providers,
      maxCostCredits: config.maxCostCredits ?? null,
    },
  };
}

/**
 * Ask every provider every prompt and persist one observation per pair. A
 * provider failure is recorded as an `unavailable` observation rather than
 * failing the run: a partial baseline is still readable, and the dashboard
 * excludes unavailable observations from its denominator.
 */
async function executeRun(
  plan: AiVisibilityRunPlan,
  billingCustomer: BillingCustomerContext,
): Promise<void> {
  const dataforseo = createDataforseoClient(billingCustomer);
  const checkedAt = new Date().toISOString();

  // The metered DataForSEO client checks the shared credit balance before each
  // provider call and records the spend after it. Serial execution is the
  // smallest coordination mechanism that makes the next check observe the
  // previous deduction; Promise.all here would let every call pass the same
  // stale balance check and overspend a nearly-empty wallet.
  const estimate = estimateAiVisibilityRunCredits({
    promptCount: plan.prompts.length,
    providers: plan.providers,
  });
  if (
    plan.maxCostCredits != null &&
    estimate.costCredits > plan.maxCostCredits
  ) {
    await AiVisibilityRepository.updateRun(plan.runId, {
      status: "failed",
      observationsCompleted: 0,
      errorMessage: "Run exceeds the approved credit ceiling",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const results: Array<{
    prompt: (typeof plan.prompts)[number];
    provider: AiVisibilityProvider;
    shaped: ShapedObservation;
  }> = [];
  for (const prompt of plan.prompts) {
    for (const provider of plan.providers) {
      let shaped: ShapedObservation;
      try {
        const answer = await dataforseo.aiVisibility.answer({
          provider,
          prompt: prompt.prompt,
          locationCode: plan.locationCode,
          languageCode: plan.languageCode,
        });
        shaped = shapeObservation({
          brandName: plan.brandName,
          domain: plan.domain,
          answer,
        });
      } catch (error) {
        console.error(`ai-visibility.observation.${provider} failed`, error);
        shaped = shapeUnavailableObservation(
          error instanceof Error ? error.message : "Provider call failed",
        );
      }
      results.push({ prompt, provider, shaped });
    }
  }

  try {
    await AiVisibilityRepository.insertObservations(
      results.map(({ prompt, provider, shaped }) => ({
        observation: {
          id: crypto.randomUUID(),
          runId: plan.runId,
          trackingPromptId: prompt.id,
          prompt: prompt.prompt,
          provider,
          status: shaped.status,
          outcome: shaped.outcome,
          mentionCount: shaped.mentionCount,
          domainCited: shaped.domainCited,
          modelName: shaped.modelName,
          errorMessage: shaped.errorMessage,
          checkedAt,
        },
        citations: shaped.citations.map((citation) => ({
          id: crypto.randomUUID(),
          url: citation.url,
          domain: citation.domain,
          position: citation.position,
          isTargetDomain: citation.isTargetDomain,
        })),
      })),
    );

    const readable = results.filter(
      (result) => result.shaped.status === "completed",
    ).length;

    // A run with zero readable observations is a failure, not a baseline of
    // zero visibility — otherwise a total provider outage would chart as the
    // brand vanishing from AI answers.
    await AiVisibilityRepository.updateRun(plan.runId, {
      status: readable > 0 ? "completed" : "failed",
      observationsCompleted: readable,
      errorMessage: readable > 0 ? null : "Every provider was unavailable",
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Provider calls may already have been charged before persistence or final
    // summary bookkeeping fails. Mark only an unfinished run: if the summary
    // update actually committed before throwing, this cannot double-complete it
    // as failed.
    try {
      await AiVisibilityRepository.markRunFailed(
        plan.runId,
        error instanceof Error ? error.message.slice(0, 500) : "Run failed",
      );
    } catch (markError) {
      console.error("ai-visibility.run.mark-failed failed", markError);
    }
    throw error;
  }
}

export const AiVisibilityService = {
  getState,
  ensureBaselineRun,
  executeRun,
};
