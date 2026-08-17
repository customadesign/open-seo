import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { captureServerEvent } from "@/server/lib/posthog";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import {
  addAiVisibilityPromptsSchema,
  aiVisibilityConfigRefSchema,
  createAiVisibilityConfigSchema,
  getAiVisibilityConfigsSchema,
  getAiVisibilityRunResultsSchema,
  removeAiVisibilityPromptsSchema,
  triggerAiVisibilityRunSchema,
  updateAiVisibilityConfigSchema,
} from "@/types/schemas/ai-visibility";

export const getAiVisibilityConfigs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiVisibilityConfigsSchema)
  .handler(async ({ context }) =>
    AiVisibilityService.getConfigs(context.projectId),
  );

export const getAiVisibilityConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiVisibilityConfigRefSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.getConfig(data.configId, context.projectId),
  );

export const createAiVisibilityConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(createAiVisibilityConfigSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.createConfig({
      projectId: context.projectId,
      projectMarket: context.project,
      brandName: data.brandName,
      domain: data.domain,
      locationCode: data.locationCode,
      languageCode: data.languageCode,
      providers: data.providers,
      scheduleInterval: data.scheduleInterval,
      isActive: data.isActive,
      maxCostCredits: data.maxCostCredits,
    }),
  );

export const updateAiVisibilityConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateAiVisibilityConfigSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.updateConfig(data.configId, context.projectId, {
      brandName: data.brandName,
      domain: data.domain,
      locationCode: data.locationCode,
      languageCode: data.languageCode,
      providers: data.providers,
      scheduleInterval: data.scheduleInterval,
      isActive: data.isActive,
      maxCostCredits: data.maxCostCredits,
    }),
  );

export const deleteAiVisibilityConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(aiVisibilityConfigRefSchema)
  .handler(async ({ data, context }) => {
    await AiVisibilityService.deleteConfig(data.configId, context.projectId);
    return { success: true };
  });

export const addAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(addAiVisibilityPromptsSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.addPrompts({
      configId: data.configId,
      projectId: context.projectId,
      prompts: data.prompts,
    }),
  );

export const removeAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(removeAiVisibilityPromptsSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.removePrompts({
      configId: data.configId,
      projectId: context.projectId,
      promptIds: data.promptIds,
    }),
  );

export const estimateAiVisibilityRun = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(aiVisibilityConfigRefSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.estimateRun(data.configId, context.projectId),
  );

export const triggerAiVisibilityRun = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(triggerAiVisibilityRunSchema)
  .handler(async ({ data, context }) => {
    const result = await AiVisibilityService.triggerRun({
      configId: data.configId,
      projectId: context.projectId,
      billingCustomer: context,
      maxCostCredits: data.maxCostCredits,
    });

    if (result.ok) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          event: "ai_visibility:run_trigger",
          organizationId: context.organizationId,
          properties: {
            project_id: context.projectId,
            config_id: data.configId,
            run_id: result.runId,
          },
        }),
      );
    }

    return result;
  });

export const getLatestAiVisibilityRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiVisibilityConfigRefSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.getLatestRun(data.configId, context.projectId),
  );

export const getAiVisibilityRunResults = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiVisibilityRunResultsSchema)
  .handler(async ({ data, context }) =>
    AiVisibilityService.getRunResults(data.runId, context.projectId),
  );
