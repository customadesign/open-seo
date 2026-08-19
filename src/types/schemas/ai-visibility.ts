import { z } from "zod";
import { aiVisibilityConfigs } from "@/db/schema";
import {
  AI_VISIBILITY_PROVIDERS,
  MAX_AI_VISIBILITY_PROMPT_LENGTH,
  MAX_PROMPTS_PER_CONFIG,
} from "@/shared/ai-visibility";
import { domainField } from "@/types/schemas/domain";
import { isSupportedLanguageCode } from "@/shared/keyword-locations";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const providerEnum = z.enum(AI_VISIBILITY_PROVIDERS);
const scheduleEnum = z.enum(aiVisibilityConfigs.scheduleInterval.enumValues);
const languageCodeField = z
  .string()
  .max(10)
  .refine(isSupportedLanguageCode, "Unsupported language code");
const brandNameField = z.string().trim().min(1).max(200);
// Credit ceilings are a spend guard, so they must be a positive whole number —
// 0 or a fraction would either block every run or round unpredictably.
const maxCostCreditsField = z.number().int().positive().max(1_000_000);
const promptField = z
  .string()
  .trim()
  .min(1)
  .max(MAX_AI_VISIBILITY_PROMPT_LENGTH);

export const getAiVisibilityConfigsSchema = z.object({
  projectId: z.string().uuid(),
});

export const createAiVisibilityConfigSchema = z.object({
  projectId: z.string().uuid(),
  brandName: brandNameField,
  domain: domainField,
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  // Omitted means "no providers enabled": a new config costs nothing to own.
  providers: z
    .array(providerEnum)
    .max(AI_VISIBILITY_PROVIDERS.length)
    .optional(),
  scheduleInterval: scheduleEnum.optional(),
  isActive: z.boolean().optional(),
  maxCostCredits: maxCostCreditsField.optional(),
});

export const updateAiVisibilityConfigSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  brandName: brandNameField.optional(),
  domain: domainField.optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  providers: z
    .array(providerEnum)
    .max(AI_VISIBILITY_PROVIDERS.length)
    .optional(),
  scheduleInterval: scheduleEnum.optional(),
  isActive: z.boolean().optional(),
  maxCostCredits: maxCostCreditsField.nullable().optional(),
});

export const aiVisibilityConfigRefSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const addAiVisibilityPromptsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  prompts: z.array(promptField).min(1).max(MAX_PROMPTS_PER_CONFIG),
});

export const removeAiVisibilityPromptsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  promptIds: z.array(z.string().uuid()).min(1).max(MAX_PROMPTS_PER_CONFIG),
});

export const triggerAiVisibilityRunSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  /** Caller-approved ceiling; combined with the config's own via Math.min. */
  maxCostCredits: maxCostCreditsField,
});

export const getAiVisibilityRunResultsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid(),
});
