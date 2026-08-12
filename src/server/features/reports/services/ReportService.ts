import { AppError } from "@/server/lib/errors";
import type {
  CreateReportScheduleInput,
  CreateReportTemplateInput,
  ReportBranding,
} from "@/types/schemas/reports";
import { reportSnapshotSchema } from "@/types/schemas/reports";
import { executeReportRun } from "../ReportRunExecutor";
import { defaultReportSectionDataSource } from "../ReportSectionDataSource";
import {
  unconfiguredReportEmailProvider,
  unconfiguredReportPdfRenderer,
} from "../providers";
import { ReportRepository } from "../repositories/ReportRepository";
import { ReportScheduleRepository } from "../repositories/ReportScheduleRepository";
import {
  createReportShareToken,
  hashReportShareToken,
  isReportShareLinkUsable,
} from "../shareTokens";
import {
  calculateNextReportRun,
  calculatePreviousReportRun,
  isValidTimezone,
} from "../scheduling";

const executionDependencies = {
  repository: ReportRepository,
  source: defaultReportSectionDataSource,
  pdfRenderer: unconfiguredReportPdfRenderer,
  emailProvider: unconfiguredReportEmailProvider,
  now: () => new Date(),
};

async function getDashboard(organizationId: string, projectId: string) {
  const [templates, schedules, runs] = await Promise.all([
    ReportRepository.listTemplates(organizationId, projectId),
    ReportRepository.listSchedules(organizationId, projectId),
    ReportRepository.listRuns(organizationId, projectId),
  ]);
  const [templateSections, scheduleRecipients] = await Promise.all([
    Promise.all(
      templates.map((template) =>
        ReportRepository.getTemplateSections(template.id),
      ),
    ),
    Promise.all(
      schedules.map(({ schedule }) =>
        ReportRepository.listRecipients(schedule.id),
      ),
    ),
  ]);
  return {
    templates: templates.map((template, index) => ({
      ...template,
      sections: templateSections[index],
    })),
    schedules: schedules.map((row, index) => ({
      ...row,
      recipients: scheduleRecipients[index],
    })),
    runs,
    providers: {
      pdf: executionDependencies.pdfRenderer.configured
        ? ("configured" as const)
        : ("unconfigured" as const),
      email: executionDependencies.emailProvider.configured
        ? ("configured" as const)
        : ("unconfigured" as const),
    },
  };
}

async function createTemplate(input: {
  organizationId: string;
  userId: string;
  data: CreateReportTemplateInput;
}) {
  const id = crypto.randomUUID();
  await ReportRepository.createTemplate(
    {
      id,
      organizationId: input.organizationId,
      projectId: input.data.projectId,
      name: input.data.name,
      isDefault: input.data.isDefault,
      brandName: input.data.branding?.brandName ?? null,
      logoUrl: input.data.branding?.logoUrl ?? null,
      primaryColor: input.data.branding?.primaryColor ?? null,
      accentColor: input.data.branding?.accentColor ?? null,
      createdByUserId: input.userId,
    },
    input.data.sections.map((section, sortOrder) => ({
      id: crypto.randomUUID(),
      templateId: id,
      sectionKey: section.key,
      sortOrder,
      isEnabled: section.enabled,
    })),
  );
  return { id };
}

async function deleteTemplate(input: {
  organizationId: string;
  projectId: string;
  templateId: string;
}) {
  const deleted = await ReportRepository.deleteTemplate(input);
  if (!deleted) throw new AppError("NOT_FOUND");
  return { id: input.templateId };
}

async function createSchedule(input: {
  organizationId: string;
  data: CreateReportScheduleInput;
  now?: Date;
}) {
  const template = await ReportRepository.getTemplateScoped({
    templateId: input.data.templateId,
    organizationId: input.organizationId,
    projectId: input.data.projectId,
  });
  if (!template) throw new AppError("NOT_FOUND");
  if (!isValidTimezone(input.data.timezone)) {
    throw new AppError("VALIDATION_ERROR", "Invalid report timezone");
  }
  const now = input.now ?? new Date();
  const nextRunAt =
    input.data.frequency === "manual"
      ? null
      : (input.data.firstRunAt ??
        calculateNextReportRun(input.data.frequency, input.data.timezone, now));
  if (nextRunAt && Date.parse(nextRunAt) <= now.getTime()) {
    throw new AppError(
      "VALIDATION_ERROR",
      "First report run must be in the future",
    );
  }

  const id = crypto.randomUUID();
  await ReportRepository.createSchedule(
    {
      id,
      projectId: input.data.projectId,
      templateId: input.data.templateId,
      name: input.data.name,
      frequency: input.data.frequency,
      timezone: input.data.timezone,
      nextRunAt,
      isActive: true,
    },
    input.data.recipients.map((recipient) => ({
      id: crypto.randomUUID(),
      scheduleId: id,
      email: recipient.email,
      name: recipient.name ?? null,
    })),
  );
  return { id, nextRunAt };
}

async function runNow(input: {
  organizationId: string;
  projectId: string;
  templateId: string;
  periodStart: string;
  periodEnd: string;
  branding?: ReportBranding;
}) {
  const template = await ReportRepository.getTemplateScoped({
    templateId: input.templateId,
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  if (!template) throw new AppError("NOT_FOUND");
  const run = await ReportRepository.createRun({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    templateId: template.id,
    scheduleId: null,
    status: "queued",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    startedAt: new Date().toISOString(),
  });
  const execution = await executeReportRun(
    {
      runId: run.id,
      projectId: input.projectId,
      organizationId: input.organizationId,
      brandingOverride: input.branding,
    },
    executionDependencies,
  );
  return { runId: run.id, ...execution };
}

async function retryRun(input: {
  organizationId: string;
  projectId: string;
  runId: string;
}) {
  const scoped = await ReportRepository.getRunScoped(input);
  if (!scoped) throw new AppError("NOT_FOUND");
  if (scoped.run.status === "completed") {
    return {
      runId: input.runId,
      status: "completed" as const,
      executed: false,
    };
  }
  const reset = await ReportRepository.resetFailedRun(
    input.runId,
    input.projectId,
  );
  if (!reset && scoped.run.status !== "queued") {
    return { runId: input.runId, status: scoped.run.status, executed: false };
  }
  const execution = await executeReportRun(input, executionDependencies);
  return { runId: input.runId, ...execution };
}

async function createShareLink(input: {
  organizationId: string;
  projectId: string;
  runId: string;
  expiresAt: string;
  now?: Date;
}) {
  const scoped = await ReportRepository.getRunScoped(input);
  if (!scoped || !scoped.run.snapshotJson) throw new AppError("NOT_FOUND");
  const now = input.now ?? new Date();
  if (Date.parse(input.expiresAt) <= now.getTime()) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Share link expiry must be in the future",
    );
  }
  const { token, tokenHash } = await createReportShareToken();
  await ReportRepository.createShareLink({
    id: crypto.randomUUID(),
    runId: input.runId,
    tokenHash,
    expiresAt: input.expiresAt,
  });
  return { token, expiresAt: input.expiresAt };
}

async function resolveShareLink(token: string, now: Date = new Date()) {
  const tokenHash = await hashReportShareToken(token);
  const row = await ReportRepository.getShareLinkByHash(tokenHash);
  if (!row || !isReportShareLinkUsable(row.link, now)) return null;
  if (!row.run.snapshotJson) return null;
  const [artifacts] = await Promise.all([
    ReportRepository.listArtifacts(row.run.id),
    ReportRepository.markShareLinkAccessed(row.link.id, now.toISOString()),
  ]);
  return {
    runId: row.run.id,
    snapshot: reportSnapshotSchema.parse(
      JSON.parse(row.run.snapshotJson) as unknown,
    ),
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      checksumSha256: artifact.checksumSha256,
    })),
    expiresAt: row.link.expiresAt,
  };
}

/** Entry point for coordinator-owned cron wiring. A compare-and-set on
 * nextRunAt means concurrent ticks enqueue each scheduled instant once. */
async function processDueSchedules(now: Date = new Date()) {
  const due = await ReportScheduleRepository.listDueSchedules(
    now.toISOString(),
  );
  const results: Array<{ scheduleId: string; runId: string; status: string }> =
    [];
  for (const { schedule, organizationId } of due) {
    if (!schedule.nextRunAt || schedule.frequency === "manual") continue;
    const observedNextRunAt = schedule.nextRunAt;
    const nextRunAt = calculateNextReportRun(
      schedule.frequency,
      schedule.timezone,
      new Date(observedNextRunAt),
    );
    const claimed = await ReportScheduleRepository.claimSchedule({
      scheduleId: schedule.id,
      observedNextRunAt,
      nextRunAt,
      lastRunAt: observedNextRunAt,
    });
    if (!claimed) continue;

    const periodStart =
      schedule.lastRunAt && schedule.lastRunAt < observedNextRunAt
        ? schedule.lastRunAt
        : calculatePreviousReportRun(
            schedule.frequency,
            schedule.timezone,
            new Date(observedNextRunAt),
          );
    const run = await ReportRepository.createRun({
      id: crypto.randomUUID(),
      projectId: schedule.projectId,
      templateId: schedule.templateId,
      scheduleId: schedule.id,
      status: "queued",
      periodStart,
      periodEnd: observedNextRunAt,
      startedAt: now.toISOString(),
    });
    const execution = await executeReportRun(
      {
        runId: run.id,
        projectId: schedule.projectId,
        organizationId,
      },
      executionDependencies,
    );
    results.push({
      scheduleId: schedule.id,
      runId: run.id,
      status: execution.status,
    });
  }
  return results;
}

export const ReportService = {
  getDashboard,
  createTemplate,
  deleteTemplate,
  createSchedule,
  runNow,
  retryRun,
  createShareLink,
  resolveShareLink,
  processDueSchedules,
} as const;
