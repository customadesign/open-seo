import { z } from "zod";
import { booleanSearchParamSchema, domainField } from "@/types/schemas/domain";
import {
  KEYWORD_GAP_CLASSIFICATIONS,
  MAX_BACKLINK_GAP_COMPETITORS,
  MAX_KEYWORD_GAP_COMPETITORS,
} from "@/shared/gap";

const competitorDomainsSchema = (max: number) =>
  z
    .array(domainField)
    .min(1)
    .max(max)
    .transform((domains) => [...new Set(domains)]);

export const keywordGapFiltersSchema = z.object({
  classifications: z.array(z.enum(KEYWORD_GAP_CLASSIFICATIONS)).optional(),
  minVolume: z.number().int().nonnegative().optional(),
  maxVolume: z.number().int().nonnegative().optional(),
  minDifficulty: z.number().int().min(0).max(100).optional(),
  maxDifficulty: z.number().int().min(0).max(100).optional(),
  intents: z.array(z.string().min(1).max(32)).optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
});

export const keywordGapCompareSchema = z.object({
  projectId: z.string().uuid(),
  baseDomain: domainField,
  competitorDomains: competitorDomainsSchema(MAX_KEYWORD_GAP_COMPETITORS),
  includeSubdomains: z.boolean().default(true),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  filters: keywordGapFiltersSchema.optional(),
});

export const keywordGapRunSchema = keywordGapCompareSchema.extend({
  maxCostCredits: z.number().int().nonnegative().max(1_000_000).optional(),
});

export const keywordGapResultsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid(),
  filters: keywordGapFiltersSchema.optional(),
});

export const backlinkGapCompareSchema = z.object({
  projectId: z.string().uuid(),
  baseDomain: domainField,
  competitorDomains: competitorDomainsSchema(MAX_BACKLINK_GAP_COMPETITORS),
});

export const backlinkGapRunSchema = backlinkGapCompareSchema.extend({
  maxCostCredits: z.number().int().nonnegative().max(1_000_000).optional(),
});

export const backlinkGapResultsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid(),
});

const optionalSearchNumber = z.coerce.number().optional().catch(undefined);

export const keywordGapSearchSchema = z.object({
  base: z.string().optional(),
  competitors: z.string().optional(),
  subdomains: booleanSearchParamSchema.optional(),
  loc: z.coerce.number().int().positive().optional().catch(undefined),
  classification: z.string().optional(),
  minVol: optionalSearchNumber,
  maxVol: optionalSearchNumber,
  minKd: optionalSearchNumber,
  maxKd: optionalSearchNumber,
  intent: z.string().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
});

export const backlinkGapSearchSchema = z.object({
  base: z.string().optional(),
  competitors: z.string().optional(),
});

export type KeywordGapCompareInput = z.infer<typeof keywordGapCompareSchema>;
export type KeywordGapSearchParams = z.infer<typeof keywordGapSearchSchema>;
export type BacklinkGapSearchParams = z.infer<typeof backlinkGapSearchSchema>;
