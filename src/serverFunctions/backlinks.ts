import { createServerFn } from "@tanstack/react-start";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { DisavowService } from "@/server/features/backlinks/services/DisavowService";
import { createToxicityAuditService } from "@/server/features/backlinks/services/ToxicityAuditService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import { requireProjectUse } from "@/serverFunctions/middleware";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import {
  backlinksAnchorsRequestSchema,
  backlinksBulkAnalysisRequestSchema,
  backlinksBulkTargetsSchema,
  backlinksCompareRequestSchema,
  backlinksNewLostRequestSchema,
  backlinksOverviewInputSchema,
  backlinksRowsPageRequestSchema,
  referringDomainsPageRequestSchema,
  topPagesPageRequestSchema,
} from "@/types/schemas/backlinks";
import {
  deleteDisavowEntrySchema,
  importDisavowEntriesSchema,
  listDisavowEntriesSchema,
  saveDisavowEntrySchema,
} from "@/types/schemas/disavow";
import {
  backlinkToxicityDomainActionSchema,
  getBacklinkToxicityAuditSchema,
  runBacklinkToxicityAuditSchema,
} from "@/types/schemas/backlink-toxicity";

// The web UI exposes spam score as a regular user filter, so the implicit
// DataForSEO spam-score cutoff stays off for all web requests.
const WEB_SPAM_OPTIONS = { hideSpam: false };

const toxicityAuditService = createToxicityAuditService({
  createClient: (customer) => createDataforseoClient(customer),
});

export const getBacklinksOverview = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(backlinksOverviewInputSchema)
  .handler(async ({ data, context }) => {
    const profile = await BacklinksService.profileOverview(
      {
        target: data.target,
        scope: data.scope,
      },
      context,
    );
    return profile.overview;
  });

export const getBacklinksRows = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(backlinksRowsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileBacklinksPage(data, context, WEB_SPAM_OPTIONS),
  );

export const getBacklinksReferringDomains = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(referringDomainsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileReferringDomainsPage(
      data,
      context,
      WEB_SPAM_OPTIONS,
    ),
  );

export const getBacklinksTopPages = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(topPagesPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileTopPagesPage(data, context),
  );

export const getBacklinksAnchors = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinksAnchorsRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileAnchors(
      { target: data.target, scope: data.scope },
      context,
    ),
  );

export const getBacklinksNewLost = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinksNewLostRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileNewLost(
      {
        target: data.target,
        scope: data.scope,
        groupRange: data.groupRange,
      },
      context,
    ),
  );

export const estimateBacklinksBulkAnalysis = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(backlinksBulkTargetsSchema)
  .handler(() => BacklinksService.estimateBulkAnalysis());

export const runBacklinksBulkAnalysis = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinksBulkAnalysisRequestSchema)
  .handler(({ data, context }) => {
    const market = resolveLabsMarket({}, context.project);
    return BacklinksService.runBulkAnalysis(
      {
        targets: data.targets,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
        maxCostCredits: data.maxCostCredits,
      },
      context,
    );
  });

export const runBacklinksCompetitorComparison = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(backlinksCompareRequestSchema)
  .handler(({ data, context }) => {
    const market = resolveLabsMarket({}, context.project);
    return BacklinksService.compareCompetitors(
      {
        target: data.target,
        competitors: data.competitors,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
        maxCostCredits: data.maxCostCredits,
      },
      context,
    );
  });

export const getDisavowEntries = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(listDisavowEntriesSchema)
  .handler(({ context }) => DisavowService.list(context.projectId));

export const saveDisavowEntry = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(saveDisavowEntrySchema)
  .handler(({ data, context }) =>
    DisavowService.save({ ...data, projectId: context.projectId }),
  );

export const importDisavowEntries = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(importDisavowEntriesSchema)
  .handler(({ data, context }) =>
    DisavowService.importEntries({ ...data, projectId: context.projectId }),
  );

export const deleteDisavowEntry = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(deleteDisavowEntrySchema)
  .handler(async ({ data, context }) => {
    const removed = await DisavowService.remove(context.projectId, data.id);
    if (!removed) throw new AppError("NOT_FOUND", "Disavow entry not found.");
    return { removed: true as const };
  });

export const exportDisavowEntries = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(listDisavowEntriesSchema)
  .handler(({ context }) => DisavowService.exportGoogleTxt(context.projectId));

export const getBacklinkToxicityAudit = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(getBacklinkToxicityAuditSchema)
  .handler(({ context }) => toxicityAuditService.getLatest(context.projectId));

export const runBacklinkToxicityAudit = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(runBacklinkToxicityAuditSchema)
  .handler(({ data, context }) =>
    toxicityAuditService.runAudit({
      projectId: context.projectId,
      target: data.target,
      scope: data.scope,
      languageCode: context.project.languageCode,
      billingCustomer: context,
    }),
  );

export const whitelistToxicityDomain = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinkToxicityDomainActionSchema)
  .handler(({ data, context }) =>
    toxicityAuditService.whitelistDomain(context.projectId, data.domain),
  );

export const moveToxicityDomainToDisavow = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinkToxicityDomainActionSchema)
  .handler(({ data, context }) =>
    toxicityAuditService.moveToDisavow(context.projectId, data.domain),
  );

export const removeToxicityDomainFromDisavow = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(backlinkToxicityDomainActionSchema)
  .handler(({ data, context }) =>
    toxicityAuditService.removeFromDisavow(context.projectId, data.domain),
  );
