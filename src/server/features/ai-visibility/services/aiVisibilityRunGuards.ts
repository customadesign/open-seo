import { env } from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import type { AiVisibilityProvider } from "@/shared/ai-visibility";

// Same coordination model as rankCheckRunGuards:
// - workflow id === run id (the workflow instance is the runtime authority)
// - a partial unique index on ai_visibility_runs(config_id) WHERE status IN
//   ('pending','running') means a failed INSERT *is* the "already running"
//   signal — no lock table
// - flipping status to completed/failed frees the slot

type RunRow = Awaited<ReturnType<typeof AiVisibilityRepository.getRunById>>;

export type AiVisibilityTriggerResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "already_running"; blockingRunId: string | null };

type WorkflowStatus = {
  status:
    | "queued"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "unknown";
  error?: { message: string };
};

const ACTIVE_WORKFLOW_STATUSES = new Set<WorkflowStatus["status"]>([
  "queued",
  "running",
  "waiting",
  "waitingForPause",
  "paused",
]);

const STARTUP_GRACE_MS = 60 * 1000;

async function getWorkflowStatus(
  runId: string,
): Promise<WorkflowStatus | null> {
  try {
    const instance = await env.AI_VISIBILITY_WORKFLOW.get(runId);
    return (await instance.status()) as WorkflowStatus;
  } catch {
    return null;
  }
}

function describeStaleRun(
  workflowStatus: WorkflowStatus | null,
  run: RunRow,
): string {
  if (run?.status === "completed" || run?.status === "failed") {
    return `Run already ${run.status}`;
  }
  if (!workflowStatus) return "Workflow instance was not found";
  if (
    workflowStatus.status === "errored" ||
    workflowStatus.status === "terminated"
  ) {
    return workflowStatus.error?.message ?? `Workflow ${workflowStatus.status}`;
  }
  if (workflowStatus.status === "complete") {
    return "Workflow completed without finalizing the run";
  }
  return `Workflow is no longer active (${workflowStatus.status})`;
}

async function getStaleRunReason(input: {
  run: RunRow;
  runId: string;
  ageMs: number;
}): Promise<string | null> {
  const workflowStatus = await getWorkflowStatus(input.runId);
  if (workflowStatus && ACTIVE_WORKFLOW_STATUSES.has(workflowStatus.status)) {
    return null;
  }

  // A run that was only just created may not have a visible workflow instance
  // yet; don't declare it stale inside the startup window.
  const withinStartupWindow =
    input.ageMs < STARTUP_GRACE_MS &&
    (!input.run ||
      input.run.status === "pending" ||
      input.run.status === "running") &&
    (!workflowStatus || workflowStatus.status === "unknown");
  if (withinStartupWindow) return null;

  return describeStaleRun(workflowStatus, input.run);
}

/** Idempotent: safe on runs that already reached a terminal status. */
export async function failAiVisibilityRunIfActive(
  runId: string,
  reason: string,
  run?: RunRow,
) {
  const current = run ?? (await AiVisibilityRepository.getRunById(runId));
  if (
    !current ||
    current.status === "completed" ||
    current.status === "failed"
  ) {
    return;
  }
  await AiVisibilityRepository.updateRun(runId, {
    status: "failed",
    errorMessage: reason,
    completedAt: new Date().toISOString(),
  });
}

export async function beginAiVisibilityRun(input: {
  configId: string;
  projectId: string;
  billingCustomer: BillingCustomerContext;
  brandName: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  providers: AiVisibilityProvider[];
  observationsTotal: number;
  maxCostCredits: number | null;
  trigger: "manual" | "scheduled";
}): Promise<AiVisibilityTriggerResult> {
  // At most two attempts: once normally, once after clearing a stale blocker.
  for (let attempt = 0; attempt < 2; attempt++) {
    const runId = crypto.randomUUID();
    const created = await AiVisibilityRepository.tryCreateRun({
      id: runId,
      configId: input.configId,
      projectId: input.projectId,
      trigger: input.trigger,
      observationsTotal: input.observationsTotal,
      maxCostCredits: input.maxCostCredits,
    });

    if (created) {
      try {
        await env.AI_VISIBILITY_WORKFLOW.create({
          id: runId,
          params: {
            runId,
            configId: input.configId,
            projectId: input.projectId,
            billingCustomer: input.billingCustomer,
            brandName: input.brandName,
            domain: input.domain,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            providers: input.providers,
            trigger: input.trigger,
            maxCostCredits: input.maxCostCredits ?? undefined,
          },
        });
      } catch (error) {
        // Release the partial-index slot, then best-effort terminate any
        // zombie instance.
        await failAiVisibilityRunIfActive(
          runId,
          "Failed to start AI visibility workflow",
        );
        try {
          const instance = await env.AI_VISIBILITY_WORKFLOW.get(runId);
          await instance.terminate();
        } catch {
          // Workflow may not have been created.
        }
        throw error;
      }
      return { ok: true, runId };
    }

    const blocker = await AiVisibilityRepository.getActiveRunForConfig(
      input.configId,
    );
    // Raced: the blocker's status flipped between insert and select. Loop.
    if (!blocker) continue;

    if (attempt === 0) {
      const staleReason = await getStaleRunReason({
        run: blocker,
        runId: blocker.id,
        ageMs: Date.now() - new Date(blocker.startedAt).getTime(),
      });
      if (staleReason) {
        await failAiVisibilityRunIfActive(blocker.id, staleReason, blocker);
        continue; // slot is free now — retry the insert
      }
    }

    return { ok: false, reason: "already_running", blockingRunId: blocker.id };
  }

  const final = await AiVisibilityRepository.getActiveRunForConfig(
    input.configId,
  );
  return {
    ok: false,
    reason: "already_running",
    blockingRunId: final?.id ?? null,
  };
}

export async function reconcileActiveAiVisibilityRun(
  run: NonNullable<RunRow>,
): Promise<{ errorMessage: string } | null> {
  if (run.status !== "running" && run.status !== "pending") return null;

  const staleReason = await getStaleRunReason({
    runId: run.id,
    run,
    ageMs: Date.now() - new Date(run.startedAt).getTime(),
  });
  return staleReason ? { errorMessage: staleReason } : null;
}
