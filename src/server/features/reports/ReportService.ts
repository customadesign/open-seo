import { AppError } from "@/server/lib/errors";
import {
  reportSnapshotSchema,
  type ReportSectionKey,
} from "@/types/schemas/reports";
import {
  comparisonPeriod,
  isValidTimeZone,
  nextMonthlyRun,
  previousFullCalendarMonth,
} from "./reportDates";
import {
  DEFAULT_REPORT_SECTIONS,
  ReportRepository,
} from "./repositories/ReportRepository";

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
      sections: settings
        ? sections.map((section) => ({
            key: section.sectionKey,
            enabled: section.isEnabled,
          }))
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
    await workflow.create({ id: workflowInstanceId, params: input });
  } catch (error) {
    await ReportRepository.failRun(
      input.runId,
      "Failed to start report workflow",
    );
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
  runId: string;
}) {
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

async function processDueSchedules(
  workflow: Env["REPORT_WORKFLOW"],
  now: Date = new Date(),
) {
  const due = await ReportRepository.listDueSettings(now.toISOString());
  let started = 0;
  for (const { settings } of due) {
    if (!settings.nextRunAt) continue;
    const observedNextRunAt = settings.nextRunAt;
    const nextRunAt = nextMonthlyRun({
      after: new Date(observedNextRunAt),
      timeZone: settings.timeZone,
      runDay: settings.runDay,
      runHour: settings.runHour,
    });
    const claimed = await ReportRepository.claimDueSettings({
      settingsId: settings.id,
      observedNextRunAt,
      nextRunAt,
    });
    if (!claimed) continue;
    const range = previousFullCalendarMonth(
      new Date(observedNextRunAt),
      settings.timeZone,
    );
    const scheduledKey = `${settings.id}:${observedNextRunAt}`;
    const run = await ReportRepository.createRun({
      id: crypto.randomUUID(),
      projectId: settings.projectId,
      settingsId: settings.id,
      trigger: "scheduled",
      scheduledKey,
      ...range,
    });
    if (!run || run.status !== "queued") continue;
    await startWorkflow(workflow, {
      projectId: settings.projectId,
      runId: run.id,
    });
    started += 1;
  }
  return { started };
}

export const ReportService = {
  getDashboard,
  updateSettings,
  generate,
  retry,
  getReport,
  processDueSchedules,
  defaultSections: DEFAULT_REPORT_SECTIONS,
};
