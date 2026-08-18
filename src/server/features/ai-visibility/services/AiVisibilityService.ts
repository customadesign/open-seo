/* eslint-disable max-lines -- Config management and the dashboard baseline share one run-guard and cost-ceiling model; splitting them would duplicate the spend rules that keep both paths honest. */
import {
  checkUsageCreditsDepleted,
  customerHasPaidPlan,
  getOrCreateOrganizationCustomer,
  type BillingCustomerContext,
} from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import {
  summarizeAiVisibilityRun,
  type AiVisibilityRunSummary,
} from "@/server/features/ai-visibility/services/aiVisibilityObservations";
import {
  beginAiVisibilityRun,
  reconcileActiveAiVisibilityRun,
  type AiVisibilityTriggerResult,
} from "@/server/features/ai-visibility/services/aiVisibilityRunGuards";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  aiVisibilityCostApprovalError,
  aiVisibilityPromptLimitError,
  buildDefaultAiVisibilityPrompts,
  DEFAULT_AI_VISIBILITY_PROVIDERS,
  deriveBrandName,
  estimateAiVisibilityRunCredits,
  MAX_AI_VISIBILITY_CONFIGS_PER_PROJECT,
  MAX_PROMPTS_PER_CONFIG,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";
import { parseDbTimestampMs } from "@/shared/db-timestamps";
import {
  computeNextCheckAt,
  isScheduledRankTrackingInterval,
} from "@/shared/rank-tracking";
import { resolveMarket } from "@/shared/keyword-locations";

type ScheduleInterval = "daily" | "weekly" | "monthly" | "manual";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function createConfig(input: {
  projectId: string;
  projectMarket: { locationCode: number; languageCode: string };
  brandName: string;
  domain: string;
  locationCode?: number;
  languageCode?: string;
  providers?: AiVisibilityProvider[];
  scheduleInterval?: ScheduleInterval;
  isActive?: boolean;
  maxCostCredits?: number;
}) {
  const brandName = input.brandName.trim();
  if (!brandName) {
    throw new AppError("VALIDATION_ERROR", "Brand name is required");
  }
  const domain = normalizeDomain(input.domain);
  const { locationCode, languageCode } = resolveMarket(
    input,
    input.projectMarket,
  );

  const existing = await AiVisibilityRepository.getConfigByBrand({
    projectId: input.projectId,
    brandName,
    locationCode,
  });
  if (existing) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This brand + location is already tracked for AI visibility",
    );
  }

  const configs = await AiVisibilityRepository.getConfigsForProject(
    input.projectId,
  );
  if (configs.length >= MAX_AI_VISIBILITY_CONFIGS_PER_PROJECT) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Maximum ${MAX_AI_VISIBILITY_CONFIGS_PER_PROJECT} AI visibility configs per project`,
    );
  }

  // Recurring spend is opt-in. Unless the caller explicitly asks for a
  // schedule AND activation, a new config never bills anything on its own.
  const scheduleInterval = input.scheduleInterval ?? "manual";
  const isActive = input.isActive ?? false;
  assertRecurringSpendApproval({
    scheduleInterval,
    isActive,
    maxCostCredits: input.maxCostCredits ?? null,
  });
  const configId = crypto.randomUUID();

  await AiVisibilityRepository.createConfig({
    id: configId,
    projectId: input.projectId,
    brandName,
    domain,
    locationCode,
    languageCode,
    scheduleInterval,
    isActive,
    maxCostCredits: input.maxCostCredits ?? null,
    nextRunAt: nextRunAtFor(scheduleInterval, isActive),
  });

  if (input.providers?.length) {
    await AiVisibilityRepository.setProvidersForConfig(
      configId,
      input.providers,
    );
  }

  return getConfig(configId, input.projectId);
}

async function updateConfig(
  configId: string,
  projectId: string,
  input: {
    brandName?: string;
    domain?: string;
    locationCode?: number;
    languageCode?: string;
    providers?: AiVisibilityProvider[];
    scheduleInterval?: ScheduleInterval;
    isActive?: boolean;
    maxCostCredits?: number | null;
  },
) {
  const existing = await requireConfig(configId, projectId);

  const updates: Parameters<typeof AiVisibilityRepository.updateConfig>[2] = {};
  if (input.brandName !== undefined) updates.brandName = input.brandName.trim();
  if (input.domain !== undefined)
    updates.domain = normalizeDomain(input.domain);
  if (input.locationCode !== undefined)
    updates.locationCode = input.locationCode;
  if (input.languageCode !== undefined)
    updates.languageCode = input.languageCode;
  if (input.maxCostCredits !== undefined) {
    updates.maxCostCredits = input.maxCostCredits;
  }

  const scheduleInterval = input.scheduleInterval ?? existing.scheduleInterval;
  const isActive = input.isActive ?? existing.isActive;
  const maxCostCredits =
    input.maxCostCredits === undefined
      ? existing.maxCostCredits
      : input.maxCostCredits;
  assertRecurringSpendApproval({
    scheduleInterval,
    isActive,
    maxCostCredits,
  });
  if (input.scheduleInterval !== undefined) {
    updates.scheduleInterval = input.scheduleInterval;
  }
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  // Recompute the anchor whenever activation or cadence changes: an inactive
  // or manual config must not keep a due timestamp the cron would act on.
  if (input.scheduleInterval !== undefined || input.isActive !== undefined) {
    updates.nextRunAt = nextRunAtFor(scheduleInterval, isActive);
  }

  await AiVisibilityRepository.updateConfig(configId, projectId, updates);

  if (input.providers !== undefined) {
    await AiVisibilityRepository.setProvidersForConfig(
      configId,
      input.providers,
    );
  }

  return getConfig(configId, projectId);
}

function nextRunAtFor(
  scheduleInterval: ScheduleInterval,
  isActive: boolean,
): string | null {
  return isActive && isScheduledRankTrackingInterval(scheduleInterval)
    ? computeNextCheckAt(scheduleInterval)
    : null;
}

async function getConfig(configId: string, projectId: string) {
  const config = await requireConfig(configId, projectId);
  const [providers, prompts] = await Promise.all([
    AiVisibilityRepository.getProvidersForConfig(configId),
    AiVisibilityRepository.getPromptsForConfig(configId),
  ]);
  return { config, providers, prompts };
}

async function deleteConfig(configId: string, projectId: string) {
  await requireConfig(configId, projectId);
  await AiVisibilityRepository.deleteConfig(configId, projectId);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

async function addPrompts(input: {
  configId: string;
  projectId: string;
  prompts: string[];
}): Promise<{ added: number; total: number }> {
  await requireConfig(input.configId, input.projectId);

  // Dedupe within the request so a caller can't burn the cap on repeats, and
  // so the existing-prompt diff below is accurate.
  const existing = await AiVisibilityRepository.getPromptsForConfig(
    input.configId,
  );
  const known = new Set(existing.map((row) => row.prompt));
  const incoming = [
    ...new Set(input.prompts.map((prompt) => prompt.trim()).filter(Boolean)),
  ].filter((prompt) => !known.has(prompt));

  const total = known.size + incoming.length;
  if (total > MAX_PROMPTS_PER_CONFIG) {
    throw new AppError("VALIDATION_ERROR", aiVisibilityPromptLimitError(total));
  }
  if (incoming.length === 0) return { added: 0, total: known.size };

  await AiVisibilityRepository.addPrompts(
    incoming.map((prompt) => ({
      id: crypto.randomUUID(),
      configId: input.configId,
      prompt,
    })),
  );
  return { added: incoming.length, total };
}

async function removePrompts(input: {
  configId: string;
  projectId: string;
  promptIds: string[];
}) {
  await requireConfig(input.configId, input.projectId);
  await AiVisibilityRepository.removePrompts(input.configId, input.promptIds);
  return {
    total: await AiVisibilityRepository.getPromptCountForConfig(input.configId),
  };
}

// ---------------------------------------------------------------------------
// Cost estimate + run
// ---------------------------------------------------------------------------

async function estimateRun(configId: string, projectId: string) {
  await requireConfig(configId, projectId);
  const [providers, prompts] = await Promise.all([
    AiVisibilityRepository.getProvidersForConfig(configId),
    AiVisibilityRepository.getActivePromptsForConfig(configId),
  ]);
  return {
    ...estimateAiVisibilityRunCredits({
      promptCount: prompts.length,
      providers,
    }),
    promptCount: prompts.length,
    providers,
  };
}

/**
 * Start a run. Refuses when the estimate exceeds the caller's approved ceiling
 * or the config's own stored ceiling — whichever is lower — so an approval
 * granted for a small prompt list can't be spent on a larger one.
 */
async function triggerRun(input: {
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  maxCostCredits: number;
}): Promise<AiVisibilityTriggerResult> {
  const config = await requireConfig(input.configId, input.projectId);
  await requireAiVisibilityAccess(input.billingCustomer.organizationId);

  const [providers, prompts] = await Promise.all([
    AiVisibilityRepository.getProvidersForConfig(input.configId),
    AiVisibilityRepository.getActivePromptsForConfig(input.configId),
  ]);
  if (providers.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enable at least one AI provider before running.",
    );
  }
  if (prompts.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Add at least one prompt before running.",
    );
  }

  const ceiling = resolveCostCeiling(
    input.maxCostCredits,
    config.maxCostCredits,
  );
  const { costCredits, observations } = estimateAiVisibilityRunCredits({
    promptCount: prompts.length,
    providers,
  });
  if (ceiling != null && costCredits > ceiling) {
    throw new AppError(
      "VALIDATION_ERROR",
      aiVisibilityCostApprovalError(costCredits, ceiling),
    );
  }

  return beginAiVisibilityRun({
    configId: config.id,
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    brandName: config.brandName,
    domain: config.domain,
    locationCode: config.locationCode,
    languageCode: config.languageCode,
    providers,
    observationsTotal: observations,
    maxCostCredits: ceiling,
    trigger: "manual",
  });
}

function assertRecurringSpendApproval(input: {
  scheduleInterval: ScheduleInterval;
  isActive: boolean;
  maxCostCredits: number | null;
}) {
  if (!input.isActive) return;
  if (input.scheduleInterval === "manual") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose a recurring schedule before activating AI visibility.",
    );
  }
  // A ceiling of 0 (or a negative one) is not an approval: it activates the
  // schedule and then skips every run with `cost_ceiling`, which looks like a
  // broken tracker rather than a deliberate setting.
  if (input.maxCostCredits == null || input.maxCostCredits <= 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Set an approved per-run credit ceiling above zero before activating AI visibility.",
    );
  }
}

/** The stricter of the caller's approval and the config's stored ceiling. */
function resolveCostCeiling(
  requested: number | null | undefined,
  stored: number | null | undefined,
): number | null {
  const values = [requested, stored].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length === 0 ? null : Math.min(...values);
}

async function getLatestRun(configId: string, projectId: string) {
  await requireConfig(configId, projectId);
  const run = await AiVisibilityRepository.getLatestRunForConfig(configId);
  if (!run) return null;

  // Report staleness only; beginAiVisibilityRun is what clears a stale
  // blocker, so this read path never mutates.
  const reconciliation = await reconcileActiveAiVisibilityRun(run);
  return {
    ...run,
    maybeStale: reconciliation !== null,
    staleReason: reconciliation?.errorMessage ?? null,
  };
}

async function getRunResults(runId: string, projectId: string) {
  const run = await AiVisibilityRepository.getRunById(runId);
  if (!run || run.projectId !== projectId) {
    throw new AppError("NOT_FOUND", "AI visibility run not found");
  }
  const [observations, citations] = await Promise.all([
    AiVisibilityRepository.getObservationsForRun(runId),
    AiVisibilityRepository.getCitationsForRun(runId),
  ]);
  const citationsByObservation = new Map<string, typeof citations>();
  for (const citation of citations) {
    const bucket = citationsByObservation.get(citation.observationId) ?? [];
    bucket.push(citation);
    citationsByObservation.set(citation.observationId, bucket);
  }
  return {
    run,
    observations: observations.map((observation) => ({
      ...observation,
      citations: citationsByObservation.get(observation.id) ?? [],
    })),
  };
}

async function requireAiVisibilityAccess(organizationId: string) {
  if (!(await isHostedServerAuthMode())) return;
  if (await customerHasPaidPlan(organizationId)) return;
  throw new AppError(
    "PAYMENT_REQUIRED",
    "Upgrade to the paid plan to run AI visibility checks",
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireConfig(configId: string, projectId: string) {
  const config = await AiVisibilityRepository.getConfigById({
    configId,
    projectId,
  });
  if (!config) {
    throw new AppError("NOT_FOUND", "AI visibility config not found");
  }
  return config;
}

function normalizeDomain(domain: string): string {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/^www\./, "");
  if (!normalized) throw new AppError("VALIDATION_ERROR", "Invalid domain");
  return normalized;
}

// ---------------------------------------------------------------------------
// Dashboard baseline
//
// The project dashboard shows two AI cards without ever calling a provider
// while rendering: `getState` reads persisted runs, and `ensureBaselineRun`
// opens a run when one is due. Collection itself goes through the same queued
// workflow as every other AI visibility run — the dashboard does not have a
// second, live-endpoint collection path of its own.
// ---------------------------------------------------------------------------

/** At most one baseline run per config per day. */
const BASELINE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type BaselineSkipReason =
  | "no_domain"
  | "not_due"
  | "already_running"
  | "plan_required"
  | "insufficient_credits"
  | "cost_ceiling";

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

type BaselineProjectInput = {
  projectId: string;
  projectName: string;
  domain: string | null;
  locationCode: number;
  languageCode: string;
};

/** Read path: persisted rows only, no provider calls and no spend. */
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

/**
 * Idempotent seed: creates the project's config on first call and tops up the
 * default providers and prompts. Never removes a provider or prompt, so a user
 * who trimmed the defaults does not get them back on the next visit.
 */
async function ensureBaselineSeed(
  input: BaselineProjectInput & { domain: string },
) {
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
      maxCostCredits: null,
      nextRunAt: null,
    });
  }

  const config = await AiVisibilityRepository.getPrimaryConfigForProject(
    input.projectId,
  );
  if (!config) return null;

  // The tracked domain follows the project's domain; the brand string does not,
  // because a user may have corrected it.
  if (config.domain !== input.domain) {
    await AiVisibilityRepository.updateConfig(config.id, input.projectId, {
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

async function baselineEligibility(
  billingCustomer: BillingCustomerContext,
): Promise<"plan_required" | "insufficient_credits" | null> {
  // Self-hosted deployments bring their own DataForSEO account: no plan or
  // credit pool to gate against.
  if (!(await isHostedServerAuthMode())) return null;

  const customer = await getOrCreateOrganizationCustomer(billingCustomer);
  if (!(await customerHasPaidPlan(customer.id))) return "plan_required";

  const { depleted } = await checkUsageCreditsDepleted(billingCustomer);
  return depleted ? "insufficient_credits" : null;
}

function isBaselineStale(timestamp: string, maxAgeMs: number): boolean {
  const ms = parseDbTimestampMs(timestamp);
  return ms === null || Date.now() - ms >= maxAgeMs;
}

/**
 * Open a baseline run when one is due, or say why not. Fast: DB reads plus the
 * billing checks only — collection happens in the AI visibility workflow that
 * `beginAiVisibilityRun` starts.
 */
async function ensureBaselineRun(
  input: BaselineProjectInput & { billingCustomer: BillingCustomerContext },
): Promise<
  | { queued: true; runId: string }
  | { queued: false; reason: BaselineSkipReason }
> {
  if (!input.domain) return { queued: false, reason: "no_domain" };

  const config = await ensureBaselineSeed({ ...input, domain: input.domain });
  if (!config) return { queued: false, reason: "no_domain" };

  const completed = await AiVisibilityRepository.getRecentCompletedRuns(
    config.id,
    1,
  );
  if (
    completed[0] &&
    !isBaselineStale(completed[0].startedAt, BASELINE_MIN_INTERVAL_MS)
  ) {
    return { queued: false, reason: "not_due" };
  }
  // `lastRunAt` is written when a run is claimed, so a failed attempt consumes
  // the same daily baseline slot as a completed attempt. This prevents a
  // provider outage from being re-spent on every manager dashboard visit.
  if (
    config.lastRunAt &&
    !isBaselineStale(config.lastRunAt, BASELINE_MIN_INTERVAL_MS)
  ) {
    return { queued: false, reason: "not_due" };
  }

  const skipReason = await baselineEligibility(input.billingCustomer);
  if (skipReason) {
    await AiVisibilityRepository.updateConfig(config.id, input.projectId, {
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
    await AiVisibilityRepository.updateConfig(config.id, input.projectId, {
      lastSkipReason: "cost_ceiling",
    });
    return { queued: false, reason: "cost_ceiling" };
  }

  const started = await beginAiVisibilityRun({
    configId: config.id,
    projectId: input.projectId,
    billingCustomer: input.billingCustomer,
    brandName: config.brandName,
    domain: config.domain,
    locationCode: config.locationCode,
    languageCode: config.languageCode,
    providers,
    observationsTotal: estimate.observations,
    maxCostCredits: config.maxCostCredits ?? null,
    trigger: "manual",
  });
  // Lost the race against a concurrent visit; the winner's run is the one.
  if (!started.ok) return { queued: false, reason: "already_running" };

  await AiVisibilityRepository.updateConfig(config.id, input.projectId, {
    lastRunAt: new Date().toISOString(),
    lastSkipReason: null,
  });

  return { queued: true, runId: started.runId };
}

export const AiVisibilityService = {
  createConfig,
  updateConfig,
  getConfig,
  deleteConfig,
  getConfigs: AiVisibilityRepository.getConfigsForProject,
  addPrompts,
  removePrompts,
  estimateRun,
  triggerRun,
  getLatestRun,
  getRunResults,
  requireAiVisibilityAccess,
  getState,
  ensureBaselineRun,
};
