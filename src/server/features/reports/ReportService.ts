import { AppError } from "@/server/lib/errors";
import { mergeReportSections } from "@/shared/report-sections";
import { customerHasPaidPlan } from "@/server/billing/subscription";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  reportSnapshotSchema,
  type ReportSectionKey,
} from "@/types/schemas/reports";
import {
  comparisonPeriod,
  isValidTimeZone,
  nextMonthlyRun,
  previousFullCalendarMonth,
  resolveDueMonthlyOccurrence,
} from "./reportDates";
import {
  DEFAULT_REPORT_SECTIONS,
  ReportRepository,
} from "./repositories/ReportRepository";

async function assertReportsPaidPlan(organizationId: string) {
  if (!(await isHostedServerAuthMode())) return;
  if (await customerHasPaidPlan(organizationId, { retryDenied: true })) return;
  throw new AppError("PAYMENT_REQUIRED", "Subscribe to generate reports.");
}

async function getOrCreateSettings(input: {
  projectId: string;
  organizationId: string;
}) {
  const existing = await ReportRepository.getSettings(input.projectId);
  if (existing) return existing;
  return ReportRepository.createDefaultSettings({
    ...input,
    timeZone: "UTC",
    nextRunAt: nextMonthlyRun({
      after: new Date(),
      timeZone: "UTC",
      runDay: 4,
      runHour: 9,
    }),
  });
}

async function getDashboard(input: {
  projectId: string;
  organizationId: string;
  publishedOnly: boolean;
}) {
  const existing = await ReportRepository.getSettings(input.projectId);
  const settings =
    existing ?? (input.publishedOnly ? null : await getOrCreateSettings(input));
  const [sections, runs] = await Promise.all([
    settings ? ReportRepository.getSections(settings.id) : Promise.resolve([]),
    ReportRepository.listRuns(input.projectId, input.publishedOnly),
  ]);
  return {
    settings: {
      timeZone: settings?.timeZone ?? "UTC",
      runDay: settings?.runDay ?? 4,
      runHour: settings?.runHour ?? 9,
      isEnabled: settings?.isEnabled ?? false,
      nextRunAt: settings?.nextRunAt ?? null,
      // Settings saved before a section shipped hold no row for it, and
      // `updateReportSettingsSchema` requires the full catalogue — so the read
      // path fills the gaps (disabled) rather than handing the form a payload
      // it cannot submit.
      sections: settings
        ? mergeReportSections(
            sections.map((section) => ({
              key: section.sectionKey,
              enabled: section.isEnabled,
            })),
          )
        : DEFAULT_REPORT_SECTIONS,
    },
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      trigger: run.trigger,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      publishedAt: run.publishedAt,
      errorMessage: input.publishedOnly ? null : run.errorMessage,
    })),
  };
}

async function updateSettings(input: {
  projectId: string;
  organizationId: string;
  timeZone: string;
  runDay: number;
  runHour: number;
  isEnabled: boolean;
  sections: Array<{ key: ReportSectionKey; enabled: boolean }>;
}) {
  if (!isValidTimeZone(input.timeZone)) {
    throw new AppError("VALIDATION_ERROR", "Choose a valid report timezone.");
  }
  if (input.isEnabled) await assertReportsPaidPlan(input.organizationId);
  const settings = await getOrCreateSettings(input);
  if (!settings) throw new Error("Could not create report settings");
  const nextRunAt = nextMonthlyRun({
    after: new Date(),
    timeZone: input.timeZone,
    runDay: input.runDay,
    runHour: input.runHour,
  });
  await ReportRepository.updateSettings({
    settingsId: settings.id,
    timeZone: input.timeZone,
    runDay: input.runDay,
    runHour: input.runHour,
    isEnabled: input.isEnabled,
    nextRunAt,
    sections: input.sections,
  });
  return { nextRunAt };
}

async function startWorkflow(
  workflow: Env["REPORT_WORKFLOW"],
  input: { projectId: string; runId: string },
) {
  const workflowInstanceId = `${input.runId}-${crypto.randomUUID()}`;
  try {
    // Persist at enqueue time, before the workflow gets CPU, so GDPR erasure
    // can terminate queued instances as well as ones that already started.
    await ReportRepository.setRunWorkflowInstanceId({
      ...input,
      workflowInstanceId,
    });
    await workflow.create({ id: workflowInstanceId, params: input });
  } catch (error) {
    await ReportRepository.failRun(
      input.runId,
      "Failed to start report workflow",
    );
    try {
      await (await workflow.get(workflowInstanceId)).terminate();
    } catch {
      // The create may have failed before an instance existed, or it may have
      // already reached a terminal state.
    }
    throw error;
  }
  return workflowInstanceId;
}

async function generate(input: {
  workflow: Env["REPORT_WORKFLOW"];
  projectId: string;
  organizationId: string;
  periodStart?: string;
  periodEnd?: string;
}) {
  if (Boolean(input.periodStart) !== Boolean(input.periodEnd)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Provide both report dates, or leave both blank.",
    );
  }
  await assertReportsPaidPlan(input.organizationId);
  const settings = await getOrCreateSettings(input);
  if (!settings) throw new Error("Could not create report settings");
  const defaults = previousFullCalendarMonth(new Date(), settings.timeZone);
  const periodStart = input.periodStart ?? defaults.periodStart;
  const periodEnd = input.periodEnd ?? defaults.periodEnd;
  if (periodStart > periodEnd) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The report start date must be on or before the end date.",
    );
  }
  const compared = input.periodStart
    ? comparisonPeriod(periodStart, periodEnd)
    : { compareStart: defaults.compareStart, compareEnd: defaults.compareEnd };
  const runId = crypto.randomUUID();
  const run = await ReportRepository.createRun({
    id: runId,
    projectId: input.projectId,
    settingsId: settings.id,
    trigger: "manual",
    periodStart,
    periodEnd,
    ...compared,
  });
  if (!run) throw new Error("Could not create report run");
  await startWorkflow(input.workflow, { projectId: input.projectId, runId });
  return { runId };
}

async function retry(input: {
  workflow: Env["REPORT_WORKFLOW"];
  projectId: string;
  organizationId: string;
  runId: string;
}) {
  await assertReportsPaidPlan(input.organizationId);
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run) throw new AppError("NOT_FOUND", "Report not found.");
  if (run.status !== "failed") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only failed reports can be retried.",
    );
  }
  if (!(await ReportRepository.resetRun(input.runId, input.projectId))) {
    throw new AppError("CONFLICT", "The report is already being retried.");
  }
  await startWorkflow(input.workflow, {
    projectId: input.projectId,
    runId: input.runId,
  });
  return { runId: input.runId };
}

async function getReport(input: {
  projectId: string;
  runId: string;
  publishedOnly: boolean;
}) {
  const run = await ReportRepository.getRun(input.projectId, input.runId);
  if (!run || (input.publishedOnly && run.status !== "published")) {
    throw new AppError("NOT_FOUND", "Report not found.");
  }
  const commentary = await ReportRepository.listCommentary(run.id);
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    publishedAt: run.publishedAt,
    errorMessage: input.publishedOnly ? null : run.errorMessage,
    snapshot: run.snapshotJson
      ? reportSnapshotSchema.parse(JSON.parse(run.snapshotJson) as unknown)
      : null,
    commentary: commentary.map((item) => ({
      kind: item.kind,
      text: item.text,
      evidenceKey: item.evidenceKey,
      isGenerated: item.isGenerated,
    })),
  };
}

type DueReportSetting = Awaited<
  ReturnType<typeof ReportRepository.listDueSettings>
>[number];

type DueSettingOutcome = "started" | "skipped_free" | "skipped_stale" | "none";

async function processDueSetting(input: {
  workflow: Env["REPORT_WORKFLOW"];
  due: DueReportSetting;
  hosted: boolean;
  now: Date;
  hasPaidPlan: (organizationId: string) => Promise<boolean>;
}): Promise<DueSettingOutcome> {
  const { settings, organizationId } = input.due;
  if (!settings.nextRunAt) return "none";
  const observedNextRunAt = settings.nextRunAt;
  // One claim covers every occurrence a stopped deployment missed, so an
  // overdue schedule can't start a report per tick until it catches up.
  const { occurrence, nextRunAt } = resolveDueMonthlyOccurrence({
    scheduledFor: new Date(observedNextRunAt),
    now: input.now,
    timeZone: settings.timeZone,
    runDay: settings.runDay,
    runHour: settings.runHour,
  });
  if (input.hosted && !(await input.hasPaidPlan(organizationId))) {
    await ReportRepository.claimDueSettings({
      settingsId: settings.id,
      observedNextRunAt,
      nextRunAt,
    });
    return "skipped_free";
  }
  const claimed = await ReportRepository.claimDueSettings({
    settingsId: settings.id,
    observedNextRunAt,
    nextRunAt,
  });
  if (!claimed) return "none";
  const range = previousFullCalendarMonth(
    new Date(occurrence),
    settings.timeZone,
  );
  // No backfilling: a missed occurrence whose month is no longer the one a
  // report generated today would cover is dropped, not queued. The schedule is
  // already advanced above, so the next report is the next live period; older
  // months stay available through manual generation.
  if (
    range.periodStart !==
    previousFullCalendarMonth(input.now, settings.timeZone).periodStart
  ) {
    return "skipped_stale";
  }
  const scheduledKey = `${settings.id}:${occurrence}`;
  const run = await ReportRepository.createRun({
    id: crypto.randomUUID(),
    projectId: settings.projectId,
    settingsId: settings.id,
    trigger: "scheduled",
    scheduledKey,
    ...range,
  });
  if (!run || run.status !== "queued") return "none";
  await startWorkflow(input.workflow, {
    projectId: settings.projectId,
    runId: run.id,
  });
  return "started";
}

async function processDueSchedules(
  workflow: Env["REPORT_WORKFLOW"],
  now: Date = new Date(),
) {
  const due = await ReportRepository.listDueSettings(now.toISOString());
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
    try {
      const outcome = await processDueSetting({
        workflow,
        due: item,
        hosted,
        now,
        hasPaidPlan,
      });
      if (outcome === "started") started += 1;
      if (outcome === "skipped_free") skippedFree += 1;
      if (outcome === "skipped_stale") skippedStale += 1;
    } catch (error) {
      errors += 1;
      console.error(
        `[cron] Report settings ${item.settings.id} failed:`,
        error,
      );
    }
  }
  // Object argument (not an interpolated string) so Workers Logs indexes the
  // fields, matching the rank-tracking and geo-grid scheduler summaries.
  const summary = {
    event: "report_scheduler_summary",
    candidates: due.length,
    started,
    skippedFree,
    skippedStale,
    errors,
  };
  (errors > 0 ? console.error : console.log)(summary);
  return summary;
}

export const ReportService = {
  getDashboard,
  updateSettings,
  generate,
  retry,
  getReport,
  processDueSchedules,
  // Shared with the delivery scheduler, which creates runs against the same
  // settings row and workflow binding.
  ensureSettings: getOrCreateSettings,
  startWorkflow,
  assertPaidPlan: assertReportsPaidPlan,
  defaultSections: DEFAULT_REPORT_SECTIONS,
};
