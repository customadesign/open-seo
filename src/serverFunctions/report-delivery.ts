import { createServerFn } from "@tanstack/react-start";
import { ReportDeliveryProfileService } from "@/server/features/reports/ReportDeliveryProfileService";
import { ReportDeliveryService } from "@/server/features/reports/ReportDeliveryService";
import { ReportShareService } from "@/server/features/reports/ReportShareService";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import {
  createReportDeliveryProfileSchema,
  createReportShareLinkSchema,
  deleteReportDeliveryProfileSchema,
  listReportDeliveriesSchema,
  listReportDeliveryProfilesSchema,
  retryReportDeliveriesSchema,
  revokeReportShareLinkSchema,
  sendTestReportDeliverySchema,
  updateReportDeliveryProfileSchema,
} from "@/types/schemas/report-delivery";

export const getReportDeliveryProfiles = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportDeliveryProfilesSchema)
  .handler(({ context }) =>
    ReportDeliveryProfileService.listProfiles(context.projectId),
  );

export const createReportDeliveryProfile = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(createReportDeliveryProfileSchema)
  .handler(({ data, context }) =>
    ReportDeliveryProfileService.createProfile({
      organizationId: context.organizationId,
      userId: context.userId,
      data: { ...data, projectId: context.projectId },
    }),
  );

export const updateReportDeliveryProfile = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateReportDeliveryProfileSchema)
  .handler(({ data, context }) =>
    ReportDeliveryProfileService.updateProfile({
      organizationId: context.organizationId,
      data: { ...data, projectId: context.projectId },
    }),
  );

export const deleteReportDeliveryProfile = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(deleteReportDeliveryProfileSchema)
  .handler(({ data, context }) =>
    ReportDeliveryProfileService.deleteProfile({
      projectId: context.projectId,
      profileId: data.profileId,
    }),
  );

export const getReportDeliveries = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportDeliveriesSchema)
  .handler(({ data, context }) =>
    ReportDeliveryService.listDeliveries({
      projectId: context.projectId,
      runId: data.runId,
    }),
  );

export const retryReportDeliveries = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(retryReportDeliveriesSchema)
  .handler(({ data, context }) =>
    ReportDeliveryService.retryDeliveries({
      projectId: context.projectId,
      runId: data.runId,
    }),
  );

export const sendTestReportDelivery = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(sendTestReportDeliverySchema)
  .handler(({ data, context }) =>
    ReportDeliveryService.sendTestDelivery({
      projectId: context.projectId,
      runId: data.runId,
      email: data.email,
      // The requester's own verified address is always a safe target; anything
      // else has to be on the operator allowlist.
      requesterEmail: context.emailVerified ? context.userEmail : null,
    }),
  );

export const createReportShareLink = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(createReportShareLinkSchema)
  .handler(({ data, context }) =>
    ReportShareService.createShareLink({
      projectId: context.projectId,
      runId: data.runId,
      expiresInDays: data.expiresInDays,
      userId: context.userId,
    }),
  );

export const getReportShareLinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportDeliveriesSchema)
  .handler(({ data, context }) =>
    ReportShareService.listShareLinks({
      projectId: context.projectId,
      runId: data.runId,
    }),
  );

export const revokeReportShareLink = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(revokeReportShareLinkSchema)
  .handler(({ data, context }) =>
    ReportShareService.revokeShareLink({
      projectId: context.projectId,
      shareLinkId: data.shareLinkId,
    }),
  );
