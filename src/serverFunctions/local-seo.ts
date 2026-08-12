import { createServerFn } from "@tanstack/react-start";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import { CitationAuditService } from "@/server/features/local-seo/services/CitationAuditService";
import { GeoGridService } from "@/server/features/local-seo/services/GeoGridService";
import { LocalListingService } from "@/server/features/local-seo/services/LocalListingService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  createGeoGridConfigSchema,
  getCitationAuditsSchema,
  getGeoGridConfigsSchema,
  getGeoGridHistorySchema,
  getLocalBusinessProfilesSchema,
  getLocalListingStatusSchema,
  runCitationAuditSchema,
  runGeoGridSchema,
  saveLocalBusinessProfileSchema,
  saveLocalListingConnectionSchema,
} from "@/types/schemas/local-seo";

export const getLocalBusinessProfiles = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getLocalBusinessProfilesSchema)
  .handler(async ({ context }) =>
    LocalSeoRepository.getProfilesForProject(context.projectId),
  );

export const saveLocalBusinessProfile = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveLocalBusinessProfileSchema)
  .handler(async ({ data, context }) =>
    LocalListingService.saveProfile({ ...data, projectId: context.projectId }),
  );

export const getLocalListingStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getLocalListingStatusSchema)
  .handler(async ({ data, context }) =>
    LocalListingService.getListingStatus(context.projectId, data.profileId),
  );

export const saveLocalListingConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveLocalListingConnectionSchema)
  .handler(async ({ data, context }) =>
    LocalListingService.saveConnection({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getGeoGridConfigs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getGeoGridConfigsSchema)
  .handler(async ({ context }) =>
    LocalSeoRepository.getGeoGridConfigs(context.projectId),
  );

export const createGeoGridConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createGeoGridConfigSchema)
  .handler(async ({ data, context }) =>
    GeoGridService.createConfig({ ...data, projectId: context.projectId }),
  );

export const getGeoGridHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getGeoGridHistorySchema)
  .handler(async ({ data, context }) =>
    GeoGridService.getHistory({ ...data, projectId: context.projectId }),
  );

export const runGeoGrid = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runGeoGridSchema)
  .handler(async ({ data, context }) =>
    GeoGridService.runGrid({
      configId: data.configId,
      projectId: context.projectId,
      billingCustomer: context,
    }),
  );

export const runCitationAudit = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runCitationAuditSchema)
  .handler(async ({ data, context }) =>
    CitationAuditService.runProviderAudit({
      ...data,
      projectId: context.projectId,
      billingCustomer: context,
    }),
  );

export const getCitationAudits = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getCitationAuditsSchema)
  .handler(async ({ data, context }) =>
    CitationAuditService.getAudits({ ...data, projectId: context.projectId }),
  );
