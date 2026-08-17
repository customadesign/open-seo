import { customerHasPaidPlan } from "@/server/billing/subscription";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { beginAiVisibilityRun } from "@/server/features/ai-visibility/services/aiVisibilityRunGuards";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  estimateAiVisibilityRunCredits,
  MAX_PROMPTS_PER_CONFIG,
} from "@/shared/ai-visibility";
import {
  computeNextCheckAt,
  isScheduledRankTrackingInterval,
} from "@/shared/rank-tracking";

// Cron body for the `scheduled` Worker handler. Nothing runs here unless an
// operator has BOTH set a non-manual schedule and activated the config —
// `getDueConfigsWithOrganization` filters on is_active and excludes "manual",
// and both default to off. A fresh deployment therefore starts a zero-spend
// scheduler.

// Observations admitted per tick (prompt × provider units). Sized well under
// DataForSEO's account request cap given that each unit costs one task_post
// slot plus one free task_get per poll round, and up to three ticks' polling
// windows overlap.
const SCHEDULED_OBSERVATION_BUDGET = 500;

// Wall-clock guard: sub-hourly crons are killed at 15 minutes and a
// skip-heavy tick pays serial plan checks per distinct org.
const TICK_DEADLINE_MS = 3 * 60_000;

export async function runScheduledAiVisibilityRuns() {
  const nowIso = new Date().toISOString();
  const dueConfigs =
    await AiVisibilityRepository.getDueConfigsWithOrganization(nowIso);
  if (dueConfigs.length === 0) return;

  const isHosted = await isHostedServerAuthMode();

  // Function-local so it lives exactly one tick: at module scope this would be
  // cross-invocation global state in Workers.
  const paidPlanChecks = new Map<string, Promise<boolean>>();
  const checkPaidPlan = (organizationId: string) => {
    let check = paidPlanChecks.get(organizationId);
    if (!check) {
      check = customerHasPaidPlan(organizationId, { retryDenied: true });
      paidPlanChecks.set(organizationId, check);
    }
    return check;
  };

  const deadline = Date.now() + TICK_DEADLINE_MS;
  let started = 0;
  let observationsStarted = 0;
  let skippedFree = 0;
  let skippedEmpty = 0;
  let alreadyRunning = 0;
  let concurrentChangeSkips = 0;
  let errors = 0;

  for (const config of dueConfigs) {
    if (Date.now() >= deadline) break;

    try {
      const interval = isScheduledRankTrackingInterval(config.scheduleInterval)
        ? config.scheduleInterval
        : null;
      // Unreachable: the due query excludes manual configs and NULL anchors.
      // Narrow rather than assert so a query change can't start an unanchored
      // paid run.
      if (!interval || !config.nextRunAt) continue;

      const observedNextRunAt = config.nextRunAt;
      const nextRunAt = computeNextCheckAt(interval, observedNextRunAt);

      const [providers, prompts] = await Promise.all([
        AiVisibilityRepository.getProvidersForConfig(config.id),
        AiVisibilityRepository.getActivePromptsForConfig(config.id),
      ]);
      // MAX_PROMPTS_PER_CONFIG is enforced on write; clamp here too so a row
      // that predates the cap (or an import) cannot post an unbounded batch.
      const activePrompts = prompts.slice(0, MAX_PROMPTS_PER_CONFIG);

      if (providers.length === 0 || activePrompts.length === 0) {
        const claimed = await AiVisibilityRepository.claimDueConfig({
          configId: config.id,
          projectId: config.projectId,
          observedNextRunAt,
          nextRunAt,
          lastSkipReason:
            providers.length === 0 ? "no_providers" : "no_prompts",
        });
        if (claimed) skippedEmpty++;
        else concurrentChangeSkips++;
        continue;
      }

      const { observations, costCredits } = estimateAiVisibilityRunCredits({
        promptCount: activePrompts.length,
        providers,
      });

      // Projected stop: admit only what fits the tick budget. The first start
      // is exempt so an oversized config can never starve.
      if (
        started > 0 &&
        observationsStarted + observations > SCHEDULED_OBSERVATION_BUDGET
      ) {
        break;
      }

      // A stored ceiling below the run's own estimate is a standing refusal —
      // skip rather than silently spending up to it.
      if (
        config.maxCostCredits == null ||
        costCredits > config.maxCostCredits
      ) {
        const claimed = await AiVisibilityRepository.claimDueConfig({
          configId: config.id,
          projectId: config.projectId,
          observedNextRunAt,
          nextRunAt,
          lastSkipReason: "cost_ceiling",
        });
        if (claimed) skippedEmpty++;
        else concurrentChangeSkips++;
        continue;
      }

      if (isHosted && !(await checkPaidPlan(config.organizationId))) {
        const claimed = await AiVisibilityRepository.claimDueConfig({
          configId: config.id,
          projectId: config.projectId,
          observedNextRunAt,
          nextRunAt,
          lastSkipReason: "plan_required",
        });
        if (claimed) skippedFree++;
        else concurrentChangeSkips++;
        continue;
      }

      // Claim the slot before starting so a crash can't retry-storm this
      // config; clearing lastSkipReason lets an upgraded org drop its badge.
      const claimed = await AiVisibilityRepository.claimDueConfig({
        configId: config.id,
        projectId: config.projectId,
        observedNextRunAt,
        nextRunAt,
        lastSkipReason: null,
      });
      if (!claimed) {
        concurrentChangeSkips++;
        continue;
      }

      const result = await beginAiVisibilityRun({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer: {
          userId: "system",
          userEmail: "system@openseo.so",
          organizationId: config.organizationId,
          projectId: config.projectId,
        },
        brandName: config.brandName,
        domain: config.domain,
        locationCode: config.locationCode,
        languageCode: config.languageCode,
        providers,
        observationsTotal: observations,
        maxCostCredits: config.maxCostCredits,
        trigger: "scheduled",
      });

      if (result.ok) {
        started++;
        observationsStarted += observations;
        continue;
      }

      alreadyRunning++;
      // Nothing started, so give the slot back and retry next tick once the
      // blocking run clears. A manual edit landing in between wins the CAS.
      await AiVisibilityRepository.claimDueConfig({
        configId: config.id,
        projectId: config.projectId,
        observedNextRunAt: nextRunAt,
        nextRunAt: observedNextRunAt,
      });
    } catch (err) {
      errors++;
      console.error(
        `[cron] Error processing AI visibility config ${config.id}:`,
        err,
      );
    }
  }

  const logSummary = errors > 0 ? console.error : console.log;
  logSummary({
    event: "ai_visibility_scheduler_summary",
    candidates: dueConfigs.length,
    started,
    observationsStarted,
    budget: SCHEDULED_OBSERVATION_BUDGET,
    skippedFree,
    skippedEmpty,
    alreadyRunning,
    concurrentChangeSkips,
    errors,
  });
}
