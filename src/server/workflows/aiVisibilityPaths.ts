import type { WorkflowStep } from "cloudflare:workers";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import {
  shapeObservation,
  shapeUnavailableObservation,
  type ShapedObservation,
} from "@/server/features/ai-visibility/services/aiVisibilityObservations";
import { fetchAiVisibilityTaskResult } from "@/server/lib/dataforseo";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { putTextToR2 } from "@/server/lib/r2";
import { pgStep } from "@/server/workflows/pgStep";
import {
  estimateAiVisibilityRunCredits,
  MAX_AI_VISIBILITY_TASKS_PER_POST,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";

const SINGLE_ATTEMPT_STEP_CONFIG = {
  retries: { limit: 0, delay: "1 second" as const },
  timeout: "2 minutes" as const,
};

// Collection is free and idempotent (observation inserts are
// onConflictDoNothing), so unlike the metered post steps it can retry.
const COLLECT_STEP_CONFIG = {
  retries: { limit: 2, delay: "10 seconds" as const },
  timeout: "5 minutes" as const,
};

// LLM tasks are slower than SERP tasks: first check after 5 minutes, then
// cumulative waits of 5/8/11/14/18/23/30 minutes before giving up. There is
// deliberately NO live fallback — the live LLM endpoints cost several times
// the queued ones, and silently multiplying a run's bill to rescue a straggler
// is worse than recording it as unavailable.
const POLL_INTERVALS = [
  "5 minutes",
  "3 minutes",
  "3 minutes",
  "3 minutes",
  "4 minutes",
  "5 minutes",
  "7 minutes",
] as const;

/** Concurrent task_get requests inside one collect step. */
const TASK_GET_CONCURRENCY = 20;

interface AiVisibilityPromptEntry {
  id: string;
  prompt: string;
}

interface AiVisibilityContext {
  client: ReturnType<typeof createDataforseoClient>;
  runId: string;
  projectId: string;
  brandName: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  providers: AiVisibilityProvider[];
  prompts: AiVisibilityPromptEntry[];
  /** Approved credit ceiling for the whole run, or null when uncapped. */
  maxCostCredits: number | null;
}

interface PendingTask {
  provider: AiVisibilityProvider;
  promptId: string;
  prompt: string;
  taskId: string;
}

export interface AiVisibilityRunStats {
  posted: number;
  collected: number;
  unavailable: number;
  /** Provider cost settled by DataForSEO, in USD (pre-markup). */
  costUsd: number;
  /** True when the approval ceiling stopped further posting. */
  stoppedByCostCeiling: boolean;
}

/**
 * Post every (prompt, provider) pair to DataForSEO's queue, poll until the
 * window closes, and persist one structured observation per pair.
 */
export async function runAiVisibilityCollection(
  step: WorkflowStep,
  ctx: AiVisibilityContext,
): Promise<AiVisibilityRunStats> {
  const stats: AiVisibilityRunStats = {
    posted: 0,
    collected: 0,
    unavailable: 0,
    costUsd: 0,
    stoppedByCostCeiling: false,
  };

  let pending: PendingTask[] = [];
  const unposted: PendingTask[] = [];
  let approvedSoFar = 0;

  for (const provider of ctx.providers) {
    for (
      let offset = 0;
      offset < ctx.prompts.length;
      offset += MAX_AI_VISIBILITY_TASKS_PER_POST
    ) {
      const chunk = ctx.prompts.slice(
        offset,
        offset + MAX_AI_VISIBILITY_TASKS_PER_POST,
      );
      const chunkCredits = estimateAiVisibilityRunCredits({
        promptCount: chunk.length,
        providers: [provider],
      }).costCredits;

      // Ceiling is enforced BEFORE each metered call, not just at trigger
      // time: a config edited mid-run must not spend past what was approved.
      if (
        ctx.maxCostCredits != null &&
        approvedSoFar + chunkCredits > ctx.maxCostCredits
      ) {
        stats.stoppedByCostCeiling = true;
        unposted.push(...chunk.map((entry) => toPending(provider, entry, "")));
        continue;
      }

      const stepName = `post-${provider}-${offset / MAX_AI_VISIBILITY_TASKS_PER_POST}`;
      try {
        const posted = await pgStep(
          step,
          stepName,
          SINGLE_ATTEMPT_STEP_CONFIG,
          async () =>
            ctx.client.aiVisibility.taskPost({
              provider,
              tasks: chunk.map((entry) => ({
                promptId: entry.id,
                prompt: entry.prompt,
              })),
              locationCode: ctx.locationCode,
              languageCode: ctx.languageCode,
            }),
        );
        approvedSoFar += chunkCredits;
        pending.push(
          ...posted.map((task) => ({
            provider,
            promptId: task.promptId,
            prompt: task.prompt,
            taskId: task.taskId,
          })),
        );
        // Entries DataForSEO rejected never get a task id — record them as
        // unavailable rather than retrying at a pricier endpoint.
        const acceptedIds = new Set(posted.map((task) => task.promptId));
        unposted.push(
          ...chunk
            .filter((entry) => !acceptedIds.has(entry.id))
            .map((entry) => toPending(provider, entry, "")),
        );
      } catch (error) {
        console.warn(`[ai-visibility] ${ctx.runId} ${stepName} failed:`, error);
        unposted.push(...chunk.map((entry) => toPending(provider, entry, "")));
      }
    }
  }

  stats.posted = pending.length;

  for (
    let round = 0;
    round < POLL_INTERVALS.length && pending.length > 0;
    round++
  ) {
    await step.sleep(`wait-${round}`, POLL_INTERVALS[round]);

    let outcome: CollectRoundOutcome;
    try {
      outcome = await pgStep(
        step,
        `collect-${round}`,
        COLLECT_STEP_CONFIG,
        () => collectRound(ctx, pending),
      );
    } catch (error) {
      // The posted tasks are already paid for — keep polling rather than
      // failing the run on one bad round.
      console.warn(
        `[ai-visibility] ${ctx.runId} collect-${round} failed:`,
        error,
      );
      continue;
    }

    stats.collected += outcome.collected;
    stats.unavailable += outcome.unavailable;
    stats.costUsd += outcome.costUsd;
    pending = outcome.stillPending;
  }

  // Whatever never finished (or was never posted) is recorded explicitly, so
  // a run's observation count always matches its prompt × provider matrix.
  const abandoned = [...unposted, ...pending];
  if (abandoned.length > 0) {
    stats.unavailable += await pgStep(
      step,
      "record-unavailable",
      COLLECT_STEP_CONFIG,
      () =>
        persistUnavailable(
          ctx,
          abandoned,
          stats.stoppedByCostCeiling
            ? "Skipped: approved cost ceiling reached"
            : "Provider did not return a result within the polling window",
        ),
    );
  }

  return stats;
}

function toPending(
  provider: AiVisibilityProvider,
  entry: AiVisibilityPromptEntry,
  taskId: string,
): PendingTask {
  return { provider, promptId: entry.id, prompt: entry.prompt, taskId };
}

interface CollectRoundOutcome {
  collected: number;
  unavailable: number;
  costUsd: number;
  stillPending: PendingTask[];
}

async function collectRound(
  ctx: AiVisibilityContext,
  tasks: PendingTask[],
): Promise<CollectRoundOutcome> {
  const ready: Array<{
    task: PendingTask;
    shaped: ShapedObservation;
    raw: unknown;
  }> = [];
  const stillPending: PendingTask[] = [];
  let costUsd = 0;
  let unavailable = 0;

  for (let i = 0; i < tasks.length; i += TASK_GET_CONCURRENCY) {
    const chunk = tasks.slice(i, i + TASK_GET_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((task) =>
        fetchAiVisibilityTaskResult({
          provider: task.provider,
          taskId: task.taskId,
        }),
      ),
    );
    settled.forEach((result, index) => {
      const task = chunk[index];
      if (result.status === "rejected") {
        // Transient task_get failure — try again next round.
        console.warn(
          `[ai-visibility] ${ctx.runId} task_get failed:`,
          result.reason,
        );
        stillPending.push(task);
        return;
      }
      costUsd += result.value.settledCostUsd ?? 0;
      if (result.value.status === "pending") {
        stillPending.push(task);
        return;
      }
      if (result.value.status === "failed") {
        unavailable += 1;
        ready.push({
          task,
          shaped: shapeUnavailableObservation(result.value.message),
          raw: null,
        });
        return;
      }
      ready.push({
        task,
        shaped: shapeObservation({
          brandName: ctx.brandName,
          domain: ctx.domain,
          answer: result.value.answer,
        }),
        raw: result.value.answer.raw,
      });
    });
  }

  if (ready.length > 0) {
    await persistObservations(ctx, ready);
    await updateProgress(ctx.runId);
  }

  return {
    collected: ready.length - unavailable,
    unavailable,
    costUsd,
    stillPending,
  };
}

async function persistObservations(
  ctx: AiVisibilityContext,
  entries: Array<{
    task: PendingTask;
    shaped: ShapedObservation;
    raw: unknown;
  }>,
) {
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const observationId = crypto.randomUUID();
      // Raw provider payloads are evidence, not product data: they live in R2
      // and the DB keeps only the key. A failed upload must not discard the
      // observation we already paid for.
      const evidenceR2Key = entry.raw
        ? await storeEvidence(ctx, observationId, entry.raw).catch((error) => {
            console.warn(
              `[ai-visibility] ${ctx.runId} evidence upload failed:`,
              error,
            );
            return null;
          })
        : null;

      return {
        observation: {
          id: observationId,
          runId: ctx.runId,
          trackingPromptId: entry.task.promptId,
          prompt: entry.task.prompt,
          provider: entry.task.provider,
          status: entry.shaped.status,
          outcome: entry.shaped.outcome,
          mentionCount: entry.shaped.mentionCount,
          domainCited: entry.shaped.domainCited,
          modelName: entry.shaped.modelName,
          providerTaskId: entry.task.taskId || null,
          evidenceR2Key,
          errorMessage: entry.shaped.errorMessage,
        },
        citations: entry.shaped.citations.map((citation) => ({
          id: crypto.randomUUID(),
          url: citation.url,
          domain: citation.domain ?? "",
          position: citation.position,
          isTargetDomain: citation.isTargetDomain,
        })),
      };
    }),
  );

  await AiVisibilityRepository.insertObservations(rows);
}

async function storeEvidence(
  ctx: AiVisibilityContext,
  observationId: string,
  raw: unknown,
): Promise<string> {
  const key = `ai-visibility/${ctx.projectId}/${ctx.runId}/${observationId}.json`;
  const uploaded = await putTextToR2(key, JSON.stringify(raw));
  return uploaded.key;
}

async function persistUnavailable(
  ctx: AiVisibilityContext,
  tasks: PendingTask[],
  reason: string,
): Promise<number> {
  await persistObservations(
    ctx,
    tasks.map((task) => ({
      task,
      shaped: shapeUnavailableObservation(reason),
      raw: null,
    })),
  );
  await updateProgress(ctx.runId);
  return tasks.length;
}

/** Progress for the UI; finalization recounts from the DB anyway. */
async function updateProgress(runId: string) {
  const observations =
    await AiVisibilityRepository.getObservationsForRun(runId);
  await AiVisibilityRepository.updateRun(runId, {
    observationsCompleted: observations.length,
  });
}
