import { AuditScheduleRepository } from "@/server/features/audit/repositories/AuditScheduleRepository";
import { clampAuditMaxPages } from "@/server/features/audit/services/audit-capacity";
import { AppError } from "@/server/lib/errors";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import type { AuditScheduleInterval } from "@/shared/audit-schedule";
import {
  computeNextCheckAt,
  isScheduledRankTrackingInterval,
} from "@/shared/rank-tracking";

async function getSchedule(projectId: string) {
  return (await AuditScheduleRepository.getByProject(projectId)) ?? null;
}

/**
 * Create or update the project's recurring audit.
 *
 * The stored anchor is only recomputed when activation or cadence changes, so
 * editing the page budget doesn't quietly move tomorrow's run. Deactivating (or
 * switching to "manual") clears the anchor outright — a paused schedule must
 * never leave a due timestamp behind for the cron to act on.
 */
async function saveSchedule(input: {
  projectId: string;
  actorUserId: string;
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  scheduleInterval: AuditScheduleInterval;
  isActive: boolean;
}) {
  if (
    input.isActive &&
    !isScheduledRankTrackingInterval(input.scheduleInterval)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose a cadence before turning the recurring audit on.",
    );
  }

  // Same validation the manual launch path runs (protocol, blocked hosts,
  // private-range SSRF), so an unusable target is rejected while the operator
  // is looking at the form instead of becoming a silent skip weeks later.
  const startUrl = await normalizeAndValidateStartUrl(input.startUrl);
  const maxPages = clampAuditMaxPages(input.maxPages);

  const existing = await AuditScheduleRepository.getByProject(input.projectId);
  const keepsAnchor =
    existing?.isActive === true &&
    existing.scheduleInterval === input.scheduleInterval &&
    existing.nextRunAt != null;

  const nextRunAt =
    input.isActive && isScheduledRankTrackingInterval(input.scheduleInterval)
      ? keepsAnchor
        ? existing.nextRunAt
        : computeNextCheckAt(input.scheduleInterval)
      : null;

  return AuditScheduleRepository.upsertForProject({
    projectId: input.projectId,
    createdByUserId: input.actorUserId,
    startUrl,
    maxPages,
    lighthouseStrategy: input.lighthouseStrategy,
    scheduleInterval: input.scheduleInterval,
    isActive: input.isActive,
    nextRunAt,
  });
}

export const AuditScheduleService = {
  getSchedule,
  saveSchedule,
} as const;
