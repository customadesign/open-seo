import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { withPgClient } from "@/db";
import { autumn } from "@/server/billing/autumn";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { failAiVisibilityRunIfActive } from "@/server/features/ai-visibility/services/aiVisibilityRunGuards";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import { captureServerEvent } from "@/server/lib/posthog";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { pgStep } from "@/server/workflows/pgStep";
import {
  runAiVisibilityCollection,
  type AiVisibilityRunStats,
} from "@/server/workflows/aiVisibilityPaths";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";
import {
  aiVisibilityCostApprovalError,
  estimateAiVisibilityRunCredits,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";

const SINGLE_ATTEMPT_STEP_CONFIG = {
  retries: { limit: 0, delay: "1 second" as const },
  timeout: "2 minutes" as const,
};

interface AiVisibilityParams {
  runId: string;
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  brandName: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  providers: AiVisibilityProvider[];
  trigger: "manual" | "scheduled";
  maxCostCredits?: number;
}

async function prepareAiVisibilityRun(input: {
  runId: string;
  configId: string;
  billingCustomer: BillingCustomerContext;
  providers: AiVisibilityProvider[];
  maxCostCredits?: number;
}) {
  // If stale-cleanup marked our run failed before we got here, bail out rather
  // than resurrecting a superseded run.
  const run = await AiVisibilityRepository.getRunById(input.runId);
  if (!run || run.status === "failed" || run.status === "completed") {
    throw new NonRetryableError(
      `Run ${input.runId} is no longer active (status=${run?.status ?? "missing"})`,
    );
  }

  await AiVisibilityRepository.updateRun(input.runId, { status: "running" });

  const prompts = await AiVisibilityRepository.getActivePromptsForConfig(
    input.configId,
  );
  if (prompts.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No prompts to ask");
  }
  if (input.providers.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No providers enabled");
  }

  // Re-estimate against the prompt list as it stands NOW: the approval was
  // granted at trigger time and prompts may have been added since.
  const { costCredits, observations } = estimateAiVisibilityRunCredits({
    promptCount: prompts.length,
    providers: input.providers,
  });
  if (input.maxCostCredits != null && costCredits > input.maxCostCredits) {
    throw new AppError(
      "VALIDATION_ERROR",
      aiVisibilityCostApprovalError(costCredits, input.maxCostCredits),
    );
  }

  if (await isHostedServerAuthMode()) {
    const [monthlyCheck, topupCheck] = await Promise.all([
      autumn.check({
        customerId: input.billingCustomer.organizationId,
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
      }),
      autumn.check({
        customerId: input.billingCustomer.organizationId,
        featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
      }),
    ]);
    const available =
      (monthlyCheck.balance?.remaining ?? 0) +
      (topupCheck.balance?.remaining ?? 0);
    if (available < costCredits) {
      throw new AppError(
        "INSUFFICIENT_CREDITS",
        "Insufficient credits for AI visibility run",
      );
    }
  }

  await AiVisibilityRepository.updateRun(input.runId, {
    observationsTotal: observations,
  });

  return {
    prompts: prompts.map((prompt) => ({
      id: prompt.id,
      prompt: prompt.prompt,
    })),
  };
}

async function finalizeRun(input: {
  runId: string;
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  trigger: AiVisibilityParams["trigger"];
  collectionError: string | null;
  stats: AiVisibilityRunStats | null;
}) {
  const run = await AiVisibilityRepository.getRunById(input.runId);
  if (!run || run.status === "failed" || run.status === "completed") {
    console.warn(
      `[ai-visibility] ${input.runId} no longer active (status=${run?.status ?? "missing"}), skipping finalization`,
    );
    return;
  }

  const nowIso = new Date().toISOString();
  const observations = await AiVisibilityRepository.getObservationsForRun(
    input.runId,
  );
  const observationsCompleted = observations.length;
  const unavailable = observations.filter(
    (observation) => observation.outcome === "unavailable",
  ).length;

  const messages: string[] = [];
  if (input.collectionError) messages.push(`Error: ${input.collectionError}`);
  if (unavailable > 0) {
    messages.push(`${unavailable} observation(s) unavailable`);
  }
  if (input.stats?.stoppedByCostCeiling) {
    messages.push("Stopped early at the approved cost ceiling");
  }

  await AiVisibilityRepository.updateRun(input.runId, {
    status: "completed",
    observationsCompleted,
    costUsd: input.stats?.costUsd ?? 0,
    completedAt: nowIso,
    ...(messages.length > 0 ? { errorMessage: messages.join(". ") } : {}),
  });

  await AiVisibilityRepository.updateConfig(input.configId, input.projectId, {
    lastRunAt: nowIso,
    lastSkipReason: null,
  });

  console.log(
    `[ai-visibility] ${input.runId} completed org=${input.billingCustomer.organizationId} project=${input.projectId} trigger=${input.trigger} observations=${observationsCompleted} unavailable=${unavailable} cost_usd=${input.stats?.costUsd ?? 0}`,
  );

  await captureServerEvent({
    distinctId: input.billingCustomer.userId,
    event: "ai_visibility:run_complete",
    organizationId: input.billingCustomer.organizationId,
    properties: {
      project_id: input.projectId,
      status: "completed",
      trigger: input.trigger,
      observations: observationsCompleted,
      unavailable,
      stopped_by_cost_ceiling: input.stats?.stoppedByCostCeiling ?? false,
    },
  });
}

async function markRunFailed(input: {
  runId: string;
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  error: unknown;
}) {
  const errorMessage =
    input.error instanceof Error ? input.error.message : "Unknown error";
  await failAiVisibilityRunIfActive(input.runId, errorMessage);

  const isInsufficientCredits =
    input.error instanceof AppError &&
    input.error.code === "INSUFFICIENT_CREDITS";
  if (isInsufficientCredits) {
    await AiVisibilityRepository.updateConfig(input.configId, input.projectId, {
      lastSkipReason: "insufficient_credits",
    });
  }

  await captureServerEvent({
    distinctId: input.billingCustomer.userId,
    event: "ai_visibility:run_complete",
    organizationId: input.billingCustomer.organizationId,
    properties: {
      project_id: input.projectId,
      status: "failed",
      error: errorMessage,
    },
  });
}

export class AiVisibilityWorkflow extends WorkflowEntrypoint<
  Env,
  AiVisibilityParams
> {
  async run(event: WorkflowEvent<AiVisibilityParams>, step: WorkflowStep) {
    return withPgClient(() => this.runScoped(event, step));
  }

  private async runScoped(
    event: WorkflowEvent<AiVisibilityParams>,
    step: WorkflowStep,
  ) {
    const {
      runId,
      configId,
      projectId,
      billingCustomer,
      brandName,
      domain,
      locationCode,
      languageCode,
      providers,
      trigger,
      maxCostCredits,
    } = event.payload;

    // Guard: the config may have been deleted or deactivated after trigger.
    const configCheck = await pgStep(
      step,
      "check-active",
      { retries: { limit: 0, delay: "1 second" } },
      async () => {
        const config = await AiVisibilityRepository.getConfigById({
          configId,
          projectId,
        });
        return { exists: config !== null };
      },
    );
    if (!configCheck.exists) {
      await failAiVisibilityRunIfActive(runId, "Config has been deleted");
      return;
    }

    try {
      console.log(
        `[ai-visibility] ${runId} starting (trigger=${trigger}, providers=${providers.join(",")})`,
      );

      const prepared = await pgStep(
        step,
        "prepare",
        { retries: { limit: 0, delay: "1 second" } },
        () =>
          prepareAiVisibilityRun({
            runId,
            configId,
            billingCustomer,
            providers,
            maxCostCredits,
          }),
      );

      let collectionError: string | null = null;
      let stats: AiVisibilityRunStats | null = null;
      try {
        stats = await runAiVisibilityCollection(step, {
          client: createDataforseoClient(billingCustomer),
          runId,
          projectId,
          brandName,
          domain,
          locationCode,
          languageCode,
          providers,
          prompts: prepared.prompts,
          maxCostCredits: maxCostCredits ?? null,
        });
      } catch (error) {
        // Observations persist incrementally, so a mid-collection failure
        // still finalizes with whatever was already paid for and collected.
        collectionError =
          error instanceof Error ? error.message : String(error);
        console.warn(`[ai-visibility] ${runId} partial failure:`, error);
      }

      await pgStep(step, "finalize", SINGLE_ATTEMPT_STEP_CONFIG, () =>
        finalizeRun({
          runId,
          configId,
          projectId,
          billingCustomer,
          trigger,
          collectionError,
          stats,
        }),
      );
    } catch (error) {
      console.error(`AI visibility run ${runId} failed:`, error);
      await pgStep(step, "mark-failed", SINGLE_ATTEMPT_STEP_CONFIG, () =>
        markRunFailed({
          runId,
          configId,
          projectId,
          billingCustomer,
          error,
        }),
      );
      throw error;
    }
  }
}
