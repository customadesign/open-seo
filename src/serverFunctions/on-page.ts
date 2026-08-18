import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { OnPageService } from "@/server/features/on-page/services/OnPageService";
import { captureServerEvent } from "@/server/lib/posthog";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import {
  addOnPageTargetSchema,
  estimateOnPageRunSchema,
  importOnPageTargetsSchema,
  onPageOverviewSchema,
  onPagePageSchema,
  removeOnPageKeywordSchema,
  removeOnPageTargetSchema,
  runOnPageCheckerSchema,
} from "@/types/schemas/on-page";

export const getOnPageOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(onPageOverviewSchema)
  .handler(async ({ context }) => {
    return OnPageService.getOverview(context.projectId);
  });

export const getOnPagePage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(onPagePageSchema)
  .handler(async ({ data, context }) => {
    return OnPageService.getPageDetail(context.projectId, data.pageId);
  });

export const addOnPageTarget = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(addOnPageTargetSchema)
  .handler(async ({ data, context }) => {
    return OnPageService.addTarget({
      projectId: context.projectId,
      url: data.url,
      keyword: data.keyword,
      locationCode: data.locationCode ?? context.project.locationCode,
      languageCode: data.languageCode ?? context.project.languageCode,
    });
  });

export const removeOnPageTarget = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(removeOnPageTargetSchema)
  .handler(async ({ data, context }) => {
    await OnPageService.removeTarget(context.projectId, data.pageId);
    return { success: true };
  });

export const removeOnPageKeyword = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(removeOnPageKeywordSchema)
  .handler(async ({ data, context }) => {
    await OnPageService.removeKeyword(context.projectId, data.keywordId);
    return { success: true };
  });

export const importOnPageTargets = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(importOnPageTargetsSchema)
  .handler(async ({ context }) => {
    return OnPageService.importTargets(context.projectId);
  });

export const estimateOnPageRun = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(estimateOnPageRunSchema)
  .handler(async ({ context }) => {
    return OnPageService.estimateRun(context.projectId);
  });

export const runOnPageChecker = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(runOnPageCheckerSchema)
  .handler(async ({ context }) => {
    const result = await OnPageService.runChecker(context.projectId, context);
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "on_page:run",
        organizationId: context.organizationId,
        properties: {
          project_id: context.projectId,
          pages_processed: result.pagesProcessed,
          serp_fetches: result.serpFetches,
          ideas_detected: result.ideasDetected,
        },
      }),
    );
    return result;
  });
