import {
  customerHasPaidPlan,
  type BillingCustomerContext,
} from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
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
  estimateAiVisibilityRunCredits,
  MAX_AI_VISIBILITY_CONFIGS_PER_PROJECT,
  MAX_PROMPTS_PER_CONFIG,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";
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
  if (input.maxCostCredits == null) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Set an approved per-run credit ceiling before activating AI visibility.",
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
};
