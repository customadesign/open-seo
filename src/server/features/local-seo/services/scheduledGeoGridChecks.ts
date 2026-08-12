import { customerHasPaidPlan } from "@/server/billing/subscription";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import {
  computeNextGeoGridRun,
  GeoGridService,
} from "@/server/features/local-seo/services/GeoGridService";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";

/**
 * Runs a deliberately small due batch. A compare-and-set advances each slot
 * before provider spend, preventing two cron invocations from billing the same
 * scheduled occurrence. Manual runs use the same active-run database guard.
 */
export async function runScheduledGeoGridChecks() {
  const nowIso = new Date().toISOString();
  const due = await LocalSeoRepository.getDueGeoGridConfigs(nowIso);
  const hosted = await isHostedServerAuthMode();
  const planChecks = new Map<string, Promise<boolean>>();
  const hasPaidPlan = (organizationId: string) => {
    let check = planChecks.get(organizationId);
    if (!check) {
      check = customerHasPaidPlan(organizationId, { retryDenied: true });
      planChecks.set(organizationId, check);
    }
    return check;
  };

  let started = 0;
  let skippedFree = 0;
  let concurrentSkips = 0;
  let alreadyRunning = 0;
  let errors = 0;

  for (const { config, organizationId } of due) {
    try {
      if (!config.nextRunAt || config.scheduleInterval === "manual") continue;
      if (hosted && !(await hasPaidPlan(organizationId))) {
        const nextRunAt = computeNextGeoGridRun(
          config.scheduleInterval,
          config.nextRunAt,
        );
        if (
          await LocalSeoRepository.claimDueGeoGridConfig({
            configId: config.id,
            projectId: config.projectId,
            observedNextRunAt: config.nextRunAt,
            nextRunAt,
          })
        ) {
          skippedFree += 1;
        } else {
          concurrentSkips += 1;
        }
        continue;
      }

      const observedNextRunAt = config.nextRunAt;
      const nextRunAt = computeNextGeoGridRun(
        config.scheduleInterval,
        observedNextRunAt,
      );
      const claimed = await LocalSeoRepository.claimDueGeoGridConfig({
        configId: config.id,
        projectId: config.projectId,
        observedNextRunAt,
        nextRunAt,
      });
      if (!claimed) {
        concurrentSkips += 1;
        continue;
      }

      const result = await GeoGridService.runGrid({
        configId: config.id,
        projectId: config.projectId,
        billingCustomer: {
          organizationId,
          projectId: config.projectId,
          userId: "system",
          userEmail: "system@openseo.so",
        },
      });
      if (result.started) {
        started += 1;
        continue;
      }

      alreadyRunning += 1;
      // Give the slot back so it can run after the active manual/cron run
      // clears. A concurrent schedule edit wins the compare-and-set.
      await LocalSeoRepository.claimDueGeoGridConfig({
        configId: config.id,
        projectId: config.projectId,
        observedNextRunAt: nextRunAt,
        nextRunAt: observedNextRunAt,
      });
    } catch (error) {
      errors += 1;
      console.error(`[cron] Geo-grid config ${config.id} failed:`, error);
    }
  }

  const summary = {
    event: "local_seo_geo_grid_scheduler_summary",
    candidates: due.length,
    started,
    skippedFree,
    concurrentSkips,
    alreadyRunning,
    errors,
  };
  (errors > 0 ? console.error : console.log)(summary);
  return summary;
}
