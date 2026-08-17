import { hasActiveAuditForProject } from "@/server/features/audit/repositories/auditRunQueries";
import { AuditScheduleRepository } from "@/server/features/audit/repositories/AuditScheduleRepository";
import { AuditService } from "@/server/features/audit/services/AuditService";
import type { AuditLimitTier } from "@/server/features/audit/services/audit-capacity";
import {
  computeNextCheckAt,
  isScheduledRankTrackingInterval,
} from "@/shared/rank-tracking";

// Cron body for the `scheduled` Worker handler. Nothing runs here unless an
// operator has BOTH chosen a cadence and activated the schedule —
// `getDueSchedulesWithOrganization` filters on is_active and excludes "manual",
// and both default to off. A fresh deployment (and any project imported from an
// older one) therefore starts with a dormant audit scheduler.

/**
 * Audits started per tick. Crawls are long-lived Workflow instances, so a fleet
 * of projects sharing one cadence must not all launch at once. Unstarted
 * schedules keep their anchor and are picked up by the following tick.
 */
const MAX_STARTS_PER_TICK = 5;

/**
 * Share the self-host sidecar's 270-second request budget with every other
 * scheduled subsystem. Unprocessed schedules remain due, so a one-minute
 * admission window can't starve reports or retention.
 */
const TICK_DEADLINE_MS = 60_000;

export async function runScheduledSiteAudits() {
  const nowIso = new Date().toISOString();
  const dueSchedules =
    await AuditScheduleRepository.getDueSchedulesWithOrganization(nowIso);
  if (dueSchedules.length === 0) return;

  const deadline = Date.now() + TICK_DEADLINE_MS;
  let started = 0;
  let deferred = 0;
  let overlapping = 0;
  let skippedPlan = 0;
  let startFailures = 0;
  let concurrentChangeSkips = 0;
  let errors = 0;

  for (const [index, schedule] of dueSchedules.entries()) {
    // Both bounds leave the remaining schedules due rather than dropping them:
    // the next tick re-reads them.
    if (started >= MAX_STARTS_PER_TICK || Date.now() >= deadline) {
      deferred = dueSchedules.length - index;
      break;
    }

    try {
      const interval = isScheduledRankTrackingInterval(
        schedule.scheduleInterval,
      )
        ? schedule.scheduleInterval
        : null;
      // Unreachable: the due query excludes manual schedules and NULL anchors.
      // Narrow rather than assert so a query change can't start an unanchored
      // crawl.
      if (!interval || !schedule.nextRunAt) continue;

      const observedNextRunAt = schedule.nextRunAt;
      // Collapses a backlog: an anchor days in the past advances straight to
      // the next FUTURE occurrence, so a long outage produces one catch-up
      // audit rather than one per missed period.
      const nextRunAt = computeNextCheckAt(interval, observedNextRunAt);

      // Never stack a second crawl on a site that is already being audited
      // (manually or by an earlier tick). The occurrence is kept, not consumed,
      // so it starts as soon as the running audit clears; the 15-minute
      // stale-audit watchdog is what stops a dead row blocking this forever.
      if (await hasActiveAuditForProject(schedule.projectId)) {
        await AuditScheduleRepository.recordSkip({
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          reason: "audit_running",
        });
        overlapping++;
        continue;
      }

      let limitTier: AuditLimitTier;
      try {
        limitTier = await AuditService.resolveAuditLimitTier(
          schedule.organizationId,
        );
      } catch {
        // An unentitled org is a standing refusal, not a transient error:
        // advance the schedule so the next tick doesn't re-ask the billing API,
        // and leave the reason on the row for the UI.
        const claimed = await AuditScheduleRepository.claimDueSchedule({
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          observedNextRunAt,
          nextRunAt,
          lastSkipReason: "plan_required",
        });
        if (claimed) skippedPlan++;
        else concurrentChangeSkips++;
        continue;
      }

      // Claim the slot before starting so two ticks can't launch the same
      // occurrence twice; clearing lastSkipReason retires a stale badge.
      const claimed = await AuditScheduleRepository.claimDueSchedule({
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        observedNextRunAt,
        nextRunAt,
        lastSkipReason: null,
      });
      if (!claimed) {
        concurrentChangeSkips++;
        continue;
      }

      try {
        const { auditId } = await AuditService.startAudit({
          actorUserId: schedule.createdByUserId,
          billingCustomer: {
            userId: "system",
            userEmail: "system@openseo.so",
            organizationId: schedule.organizationId,
            projectId: schedule.projectId,
          },
          projectId: schedule.projectId,
          startUrl: schedule.startUrl,
          maxPages: schedule.maxPages,
          lighthouseStrategy: schedule.lighthouseStrategy,
          limitTier,
        });
        await AuditScheduleRepository.recordRunStarted({
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          auditId,
          lastRunAt: nowIso,
        });
        started++;
      } catch (err) {
        // The slot is already spent, so the refusal has to be visible on the
        // row — otherwise a schedule that can never start looks idle.
        startFailures++;
        await AuditScheduleRepository.recordSkip({
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          reason: "start_failed",
        });
        console.error(
          `[cron] Scheduled audit failed to start for project ${schedule.projectId}:`,
          err,
        );
      }
    } catch (err) {
      errors++;
      console.error(
        `[cron] Error processing audit schedule ${schedule.id}:`,
        err,
      );
    }
  }

  const logSummary =
    errors > 0 || startFailures > 0 ? console.error : console.log;
  logSummary({
    event: "site_audit_scheduler_summary",
    candidates: dueSchedules.length,
    started,
    deferred,
    overlapping,
    skippedPlan,
    startFailures,
    concurrentChangeSkips,
    errors,
  });
}
