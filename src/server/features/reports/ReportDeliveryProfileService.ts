import { customerHasPaidPlan } from "@/server/billing/subscription";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { MAX_SHARE_LINK_TTL_DAYS } from "@/shared/report-delivery";
import { mergeReportSections } from "@/shared/report-sections";
import type {
  CreateReportDeliveryProfileInput,
  UpdateReportDeliveryProfileInput,
} from "@/types/schemas/report-delivery";
import { getReportProviders } from "./defaultReportProviders";
import {
  deliveryPeriod,
  isValidTimeZone,
  nextDeliveryRun,
  resolveDueOccurrence,
} from "./reportDates";
import {
  isScheduledRecipientAllowed,
  loadReportDeliveryGuard,
} from "./reportTestRecipients";
import { ReportRepository } from "./repositories/ReportRepository";
import {
  ReportDeliveryProfileRepository,
  type ProfileWritableFields,
} from "./repositories/ReportDeliveryProfileRepository";
import { ReportService } from "./ReportService";

type ProfileInput =
  | CreateReportDeliveryProfileInput
  | UpdateReportDeliveryProfileInput;

function profileFields(data: ProfileInput, now: Date): ProfileWritableFields {
  if (!isValidTimeZone(data.timeZone)) {
    throw new AppError("VALIDATION_ERROR", "Choose a valid report timezone.");
  }
  return {
    name: data.name,
    frequency: data.frequency,
    timeZone: data.timeZone,
    runDay: data.runDay,
    runWeekday: data.runWeekday,
    runHour: data.runHour,
    isEnabled: data.isEnabled,
    brandName: data.branding.brandName,
    logoUrl: data.branding.logoUrl,
    primaryColor: data.branding.primaryColor,
    accentColor: data.branding.accentColor,
    attachPdf: data.attachPdf,
    includeShareLink: data.includeShareLink,
    shareLinkTtlDays: Math.min(data.shareLinkTtlDays, MAX_SHARE_LINK_TTL_DAYS),
    // A disabled profile keeps no schedule, so re-enabling always recomputes
    // from the current clock instead of firing a stale backlog.
    nextRunAt: data.isEnabled
      ? nextDeliveryRun({
          after: now,
          timeZone: data.timeZone,
          frequency: data.frequency,
          runDay: data.runDay,
          runWeekday: data.runWeekday,
          runHour: data.runHour,
        })
      : null,
  };
}

async function listProfiles(projectId: string) {
  const rows = await ReportDeliveryProfileRepository.listProfiles(projectId);
  const [providers, guard] = await Promise.all([
    getReportProviders(),
    loadReportDeliveryGuard(),
  ]);
  return {
    providers: {
      pdf: providers.pdfRenderer.configured ? "configured" : "unconfigured",
      email: providers.emailProvider.configured ? "configured" : "unconfigured",
    },
    // Delivery is fail-closed, so a profile can look healthy while every
    // scheduled send is silently recorded as skipped. Surface the guard state
    // with the profiles rather than leaving it to the operator's memory of an
    // environment variable.
    delivery: {
      testMode: guard.testMode,
      allowlistSize: guard.allowlist.size,
    },
    profiles: rows.map(({ profile, sections, recipients }) => ({
      id: profile.id,
      name: profile.name,
      frequency: profile.frequency,
      timeZone: profile.timeZone,
      runDay: profile.runDay,
      runWeekday: profile.runWeekday,
      runHour: profile.runHour,
      isEnabled: profile.isEnabled,
      attachPdf: profile.attachPdf,
      includeShareLink: profile.includeShareLink,
      shareLinkTtlDays: profile.shareLinkTtlDays,
      nextRunAt: profile.nextRunAt,
      lastRunAt: profile.lastRunAt,
      branding: {
        brandName: profile.brandName,
        logoUrl: profile.logoUrl,
        primaryColor: profile.primaryColor,
        accentColor: profile.accentColor,
      },
      // A profile stored before a section shipped keeps sending exactly what
      // it sent yesterday: the missing key comes back disabled, so a client's
      // report never gains a section without an operator turning it on.
      sections: mergeReportSections(
        sections.map((section) => ({
          key: section.sectionKey,
          enabled: section.isEnabled,
        })),
      ),
      recipients: recipients.map((recipient) => ({
        email: recipient.email,
        name: recipient.name,
        // False means a scheduled run records this address as `skipped`.
        isAllowed: isScheduledRecipientAllowed(recipient.email, guard),
      })),
    })),
  };
}

async function createProfile(input: {
  organizationId: string;
  userId: string;
  data: CreateReportDeliveryProfileInput;
  now?: Date;
}) {
  if (input.data.isEnabled) {
    await ReportService.assertPaidPlan(input.organizationId);
  }
  const id = crypto.randomUUID();
  await ReportDeliveryProfileRepository.createProfile({
    id,
    projectId: input.data.projectId,
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    fields: profileFields(input.data, input.now ?? new Date()),
    sections: input.data.sections,
    recipients: input.data.recipients,
  });
  return { profileId: id };
}

async function updateProfile(input: {
  organizationId: string;
  data: UpdateReportDeliveryProfileInput;
  now?: Date;
}) {
  const existing = await ReportDeliveryProfileRepository.getProfile(
    input.data.projectId,
    input.data.profileId,
  );
  if (!existing) throw new AppError("NOT_FOUND", "Delivery profile not found.");
  if (input.data.isEnabled) {
    await ReportService.assertPaidPlan(input.organizationId);
  }
  await ReportDeliveryProfileRepository.updateProfile({
    profileId: existing.id,
    fields: profileFields(input.data, input.now ?? new Date()),
    sections: input.data.sections,
    recipients: input.data.recipients,
  });
  return { profileId: existing.id };
}

async function deleteProfile(input: { projectId: string; profileId: string }) {
  const deleted = await ReportDeliveryProfileRepository.deleteProfile(
    input.projectId,
    input.profileId,
  );
  if (!deleted) throw new AppError("NOT_FOUND", "Delivery profile not found.");
  return { profileId: input.profileId };
}

type DueProfile = Awaited<
  ReturnType<typeof ReportDeliveryProfileRepository.listDueProfiles>
>[number];

/** Inclusive length of a reporting window, in milliseconds. */
function periodLengthMs(period: { periodStart: string; periodEnd: string }) {
  return (
    Date.parse(`${period.periodEnd}T00:00:00Z`) -
    Date.parse(`${period.periodStart}T00:00:00Z`) +
    86_400_000
  );
}

async function startProfileRun(input: {
  workflow: Env["REPORT_WORKFLOW"];
  due: DueProfile;
  occurrence: string;
  period: ReturnType<typeof deliveryPeriod>;
}) {
  const { profile } = input.due;
  const settings = await ReportService.ensureSettings({
    projectId: profile.projectId,
    organizationId: input.due.organizationId,
  });
  if (!settings) throw new Error("Could not create report settings");
  const run = await ReportRepository.createRun({
    id: crypto.randomUUID(),
    projectId: profile.projectId,
    settingsId: settings.id,
    trigger: "scheduled",
    scheduledKey: `profile:${profile.id}:${input.occurrence}`,
    profileId: profile.id,
    ...input.period,
  });
  if (!run || run.status !== "queued") return null;
  await ReportService.startWorkflow(input.workflow, {
    projectId: profile.projectId,
    runId: run.id,
  });
  return run.id;
}

/**
 * Cron entry point. Claiming a profile is a compare-and-set on `nextRunAt`, so
 * a slow tick overlapping the next one cannot deliver the same period twice.
 */
async function processDueProfiles(
  workflow: Env["REPORT_WORKFLOW"],
  now: Date = new Date(),
) {
  const due = await ReportDeliveryProfileRepository.listDueProfiles(
    now.toISOString(),
  );
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
  let skippedStale = 0;
  let errors = 0;
  for (const item of due) {
    const observedNextRunAt = item.profile.nextRunAt;
    if (!observedNextRunAt) continue;
    const { frequency, timeZone } = item.profile;
    try {
      // One claim covers every occurrence a stopped deployment missed, so an
      // overdue profile jumps straight to its next future slot instead of
      // starting one backlog report per tick until it catches up.
      const { occurrence, nextRunAt } = resolveDueOccurrence({
        scheduledFor: new Date(observedNextRunAt),
        now,
        timeZone,
        frequency,
        runDay: item.profile.runDay,
        runWeekday: item.profile.runWeekday,
        runHour: item.profile.runHour,
      });
      const claimed = await ReportDeliveryProfileRepository.claimProfile({
        profileId: item.profile.id,
        observedNextRunAt,
        nextRunAt,
        lastRunAt: occurrence,
      });
      // Claim first even for unpaid organizations: the schedule still advances,
      // it just does not produce a run.
      if (!claimed) continue;
      if (hosted && !(await hasPaidPlan(item.organizationId))) {
        skippedFree += 1;
        continue;
      }
      // No backfilling: the newest missed occurrence is only worth delivering
      // while it is less than one reporting period late. A longer gap means its
      // window has already been superseded, and the next scheduled run covers
      // fresher data than a backfilled email would. Older windows stay
      // available through manual generation.
      const period = deliveryPeriod(frequency, new Date(occurrence), timeZone);
      if (now.valueOf() - Date.parse(occurrence) > periodLengthMs(period)) {
        skippedStale += 1;
        continue;
      }
      const runId = await startProfileRun({
        workflow,
        due: item,
        occurrence,
        period,
      });
      if (runId) started += 1;
    } catch (error) {
      console.error(
        `[cron] Delivery profile ${item.profile.id} failed:`,
        error,
      );
      errors += 1;
    }
  }
  return { started, skippedFree, skippedStale, errors };
}

export const ReportDeliveryProfileService = {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  processDueProfiles,
};
