import { createServerFn } from "@tanstack/react-start";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { DisavowService } from "@/server/features/backlinks/services/DisavowService";
import { AppError } from "@/server/lib/errors";
import { requireProjectUse } from "@/serverFunctions/middleware";
import {
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

// The web UI exposes spam score as a regular user filter, so the implicit
// DataForSEO spam-score cutoff stays off for all web requests.
const WEB_SPAM_OPTIONS = { hideSpam: false };

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
