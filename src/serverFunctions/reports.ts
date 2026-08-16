import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { AppError } from "@/server/lib/errors";
import { ReportService } from "@/server/features/reports/ReportService";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import {
  generateReportSchema,
  getReportRunSchema,
  listReportsSchema,
  retryReportSchema,
  updateReportCommentarySchema,
  updateReportSettingsSchema,
} from "@/types/schemas/reports";
import { ReportRepository } from "@/server/features/reports/repositories/ReportRepository";

export const getReportsDashboard = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema)
  .handler(({ context }) =>
    ReportService.getDashboard({
      projectId: context.projectId,
      organizationId: context.organizationId,
      publishedOnly: context.access.role === "client",
    }),
  );

export const getReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getReportRunSchema)
  .handler(({ data, context }) =>
    ReportService.getReport({
      projectId: context.projectId,
      runId: data.runId,
      publishedOnly: context.access.role === "client",
    }),
  );

export const saveReportSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateReportSettingsSchema)
  .handler(({ data, context }) =>
    ReportService.updateSettings({
      ...data,
      projectId: context.projectId,
      organizationId: context.organizationId,
    }),
  );

export const generateReport = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(generateReportSchema)
  .handler(({ data, context }) =>
    ReportService.generate({
      workflow: env.REPORT_WORKFLOW,
      projectId: context.projectId,
      organizationId: context.organizationId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
    }),
  );

export const retryReport = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(retryReportSchema)
  .handler(({ data, context }) =>
    ReportService.retry({
      workflow: env.REPORT_WORKFLOW,
      projectId: context.projectId,
      runId: data.runId,
    }),
  );

export const saveReportCommentary = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateReportCommentarySchema)
  .handler(async ({ data, context }) => {
    const run = await ReportRepository.getRun(context.projectId, data.runId);
    if (!run || run.status !== "published") {
      throw new AppError("NOT_FOUND", "Published report not found.");
    }
    await ReportRepository.replaceCommentary({
      runId: run.id,
      userId: context.userId,
      items: data.items,
    });
    return { saved: true as const };
  });
