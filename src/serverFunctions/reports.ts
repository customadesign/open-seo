import { createServerFn } from "@tanstack/react-start";
import { ReportService } from "@/server/features/reports/services/ReportService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  createReportScheduleSchema,
  createReportShareLinkSchema,
  createReportTemplateSchema,
  listReportsSchema,
  retryReportRunSchema,
  runReportSchema,
} from "@/types/schemas/reports";

export const getReportDashboard = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema)
  .handler(({ context }) =>
    ReportService.getDashboard(context.organizationId, context.projectId),
  );

export const createReportTemplate = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createReportTemplateSchema)
  .handler(({ data, context }) =>
    ReportService.createTemplate({
      organizationId: context.organizationId,
      userId: context.userId,
      data: { ...data, projectId: context.projectId },
    }),
  );

export const createReportSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createReportScheduleSchema)
  .handler(({ data, context }) =>
    ReportService.createSchedule({
      organizationId: context.organizationId,
      data: { ...data, projectId: context.projectId },
    }),
  );

export const runReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runReportSchema)
  .handler(({ data, context }) =>
    ReportService.runNow({
      organizationId: context.organizationId,
      projectId: context.projectId,
      templateId: data.templateId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      branding: data.branding,
    }),
  );

export const retryReportRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(retryReportRunSchema)
  .handler(({ data, context }) =>
    ReportService.retryRun({
      organizationId: context.organizationId,
      projectId: context.projectId,
      runId: data.runId,
    }),
  );

export const createReportShareLink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createReportShareLinkSchema)
  .handler(({ data, context }) =>
    ReportService.createShareLink({
      organizationId: context.organizationId,
      projectId: context.projectId,
      runId: data.runId,
      expiresAt: data.expiresAt,
    }),
  );
