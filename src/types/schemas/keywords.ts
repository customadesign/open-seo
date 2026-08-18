import { z } from "zod";
import { TAG_COLOR_KEYS } from "@/shared/tag-colors";
import { booleanSearchParamSchema } from "@/types/schemas/domain";

const savedKeywordTagSchema = z.string().trim().min(1).max(64);
const tagColorSchema = z.enum(TAG_COLOR_KEYS);
const savedKeywordSortFields = [
  "createdAt",
  "keyword",
  "searchVolume",
  "cpc",
  "competition",
  "keywordDifficulty",
  "fetchedAt",
] as const;
const sortDirs = ["asc", "desc"] as const;

export const researchKeywordsSchema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(200),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  resultLimit: z
    .union([z.literal(150), z.literal(300), z.literal(500)])
    .default(150),
  mode: z
    .enum(["auto", "related", "suggestions", "ideas"])
    .optional()
    .default("auto"),
  // Clickstream-refined volumes double the DataForSEO request cost; opt-in.
  clickstream: z.boolean().optional().default(false),
});

export const saveKeywordsSchema = z
  .object({
    projectId: z.string().min(1),
    keywords: z.array(z.string().min(1)).min(1).max(500),
    locationCode: z.number().int().positive().optional(),
    languageCode: z.string().min(2).max(8).optional(),
    tags: z.array(savedKeywordTagSchema).max(20).optional(),
    tagMode: z.enum(["append", "replace"]).optional(),
    metrics: z
      .array(
        z.object({
          keyword: z.string().min(1),
          searchVolume: z.number().int().nonnegative().nullable().optional(),
          cpc: z.number().nonnegative().nullable().optional(),
          competition: z.number().min(0).max(1).nullable().optional(),
          keywordDifficulty: z
            .number()
            .int()
            .min(0)
            .max(100)
            .nullable()
            .optional(),
          intent: z
            .enum([
              "informational",
              "commercial",
              "transactional",
              "navigational",
              "unknown",
            ])
            .nullable()
            .optional(),
          monthlySearches: z
            .array(
              z.object({
                year: z.number().int().positive(),
                month: z.number().int().min(1).max(12),
                searchVolume: z.number().int().nonnegative(),
              }),
            )
            .optional(),
        }),
      )
      .max(500)
      .optional(),
  })
  .refine(
    (value) => value.tagMode !== "replace" || (value.tags?.length ?? 0) > 0,
    "Replacement tags are required when tagMode is replace.",
  );

export const removeSavedKeywordsSchema = z.object({
  projectId: z.string().min(1),
  savedKeywordIds: z.array(z.string().min(1)).min(1).max(2000),
});

export const getSavedKeywordsSchema = z.object({
  projectId: z.string().min(1),
  search: z.string().trim().max(200).optional(),
  includeTerms: z.array(z.string().trim().min(1)).max(20).optional(),
  excludeTerms: z.array(z.string().trim().min(1)).max(20).optional(),
  minVolume: z.number().int().nonnegative().nullable().optional(),
  maxVolume: z.number().int().nonnegative().nullable().optional(),
  minCpc: z.number().nonnegative().nullable().optional(),
  maxCpc: z.number().nonnegative().nullable().optional(),
  minDifficulty: z.number().int().min(0).max(100).nullable().optional(),
  maxDifficulty: z.number().int().min(0).max(100).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional(),
  tagNames: z.array(savedKeywordTagSchema).max(50).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z
    .union([z.literal(50), z.literal(100), z.literal(250)])
    .default(50),
  sort: z.enum(savedKeywordSortFields).default("createdAt"),
  order: z.enum(sortDirs).default("desc"),
});

export const exportSavedKeywordsSchema = getSavedKeywordsSchema.omit({
  page: true,
  pageSize: true,
});

export const updateSavedKeywordTagsSchema = z
  .object({
    projectId: z.string().min(1),
    savedKeywordIds: z.array(z.string().min(1)).min(1).max(2000),
    addTags: z.array(savedKeywordTagSchema).max(20).optional(),
    removeTagIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine(
    (value) =>
      (value.addTags?.length ?? 0) > 0 || (value.removeTagIds?.length ?? 0) > 0,
    "Add or remove at least one tag.",
  );

export const updateSavedKeywordTagSchema = z
  .object({
    projectId: z.string().min(1),
    tagId: z.string().min(1),
    name: savedKeywordTagSchema.optional(),
    color: tagColorSchema.nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.color !== undefined,
    "Provide a name or color to update.",
  );

export const deleteSavedKeywordTagSchema = z.object({
  projectId: z.string().min(1),
  tagId: z.string().min(1),
});

export const refreshSavedKeywordMetricsSchema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1)).max(2000).optional(),
});

const keywordMagicMatchTypes = [
  "all",
  "broad",
  "phrase",
  "exact",
  "related",
  "questions",
] as const;

const keywordMagicSortFields = [
  "keyword",
  "searchVolume",
  "cpc",
  "competition",
  "keywordDifficulty",
  "wordCount",
  "metricsUpdatedAt",
] as const;

const keywordMagicScaleSchema = z.union([
  z.literal(1000),
  z.literal(5000),
  z.literal(10000),
  z.literal(20000),
]);

export const estimateKeywordMagicSchema = z.object({
  projectId: z.string().min(1),
  seed: z.string().min(1),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
  clickstream: z.boolean().optional().default(false),
  maxKeywords: keywordMagicScaleSchema.optional(),
});

export const runKeywordMagicSchema = estimateKeywordMagicSchema.extend({
  maxCostCredits: z.number().int().positive().max(1_000_000).optional(),
});

const keywordMagicFilterFields = {
  matchType: z.enum(keywordMagicMatchTypes).optional(),
  clusterId: z.string().min(1).optional(),
  includeTerms: z.array(z.string().trim().min(1)).max(20).optional(),
  excludeTerms: z.array(z.string().trim().min(1)).max(20).optional(),
  minVolume: z.number().int().nonnegative().nullable().optional(),
  maxVolume: z.number().int().nonnegative().nullable().optional(),
  minCpc: z.number().nonnegative().nullable().optional(),
  maxCpc: z.number().nonnegative().nullable().optional(),
  minDifficulty: z.number().int().min(0).max(100).nullable().optional(),
  maxDifficulty: z.number().int().min(0).max(100).nullable().optional(),
  minWordCount: z.number().int().min(1).nullable().optional(),
  maxWordCount: z.number().int().min(1).nullable().optional(),
  intents: z
    .array(
      z.enum([
        "informational",
        "commercial",
        "transactional",
        "navigational",
        "unknown",
      ]),
    )
    .optional(),
  serpFeatures: z.array(z.string().min(1).max(64)).max(20).optional(),
};

export const getKeywordMagicPageSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  ...keywordMagicFilterFields,
  page: z.number().int().positive().default(1),
  pageSize: z
    .union([z.literal(50), z.literal(100), z.literal(300), z.literal(500)])
    .default(50),
  sort: z.enum(keywordMagicSortFields).default("searchVolume"),
  order: z.enum(sortDirs).default("desc"),
});

export const exportKeywordMagicSchema = getKeywordMagicPageSchema.omit({
  page: true,
  pageSize: true,
});

export const listKeywordMagicHistorySchema = z.object({
  projectId: z.string().min(1),
});

export const saveKeywordMagicSelectionSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(500),
  tags: z.array(savedKeywordTagSchema).max(20).optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
});

export const refreshKeywordMagicMetricsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(500),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
});

export type EstimateKeywordMagicInput = z.infer<
  typeof estimateKeywordMagicSchema
>;
export type RunKeywordMagicInput = z.infer<typeof runKeywordMagicSchema>;
export type GetKeywordMagicPageInput = z.infer<
  typeof getKeywordMagicPageSchema
>;
export type ExportKeywordMagicInput = z.infer<typeof exportKeywordMagicSchema>;
export type SaveKeywordMagicSelectionInput = z.infer<
  typeof saveKeywordMagicSelectionSchema
>;
export type RefreshKeywordMagicMetricsInput = z.infer<
  typeof refreshKeywordMagicMetricsSchema
>;

export type ResearchKeywordsInput = z.infer<typeof researchKeywordsSchema>;
export type SaveKeywordsInput = z.infer<typeof saveKeywordsSchema>;
type ResolvedMarket = { locationCode: number; languageCode: string };
export type ResolvedResearchKeywordsInput = Omit<
  ResearchKeywordsInput,
  keyof ResolvedMarket
> &
  ResolvedMarket;
export type ResolvedSaveKeywordsInput = Omit<
  SaveKeywordsInput,
  keyof ResolvedMarket
> &
  ResolvedMarket;
export type RemoveSavedKeywordsInput = z.infer<
  typeof removeSavedKeywordsSchema
>;
export type GetSavedKeywordsInput = z.infer<typeof getSavedKeywordsSchema>;
export type ExportSavedKeywordsInput = z.infer<
  typeof exportSavedKeywordsSchema
>;
export type UpdateSavedKeywordTagsInput = z.infer<
  typeof updateSavedKeywordTagsSchema
>;
export type UpdateSavedKeywordTagInput = z.infer<
  typeof updateSavedKeywordTagSchema
>;
export type DeleteSavedKeywordTagInput = z.infer<
  typeof deleteSavedKeywordTagSchema
>;

export type RefreshSavedKeywordMetricsInput = z.infer<
  typeof refreshSavedKeywordMetricsSchema
>;
export const serpAnalysisSchema = z.object({
  projectId: z.string().min(1),
  keyword: z.string().min(1),
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().min(2).max(8).optional(),
});

/* ------------------------------------------------------------------ */
/*  URL search params schema for /p/$projectId/keywords                */
/* ------------------------------------------------------------------ */

const keywordSortFields = [
  "keyword",
  "searchVolume",
  "cpc",
  "competition",
  "keywordDifficulty",
  "wordCount",
  "metricsUpdatedAt",
] as const;

const keywordModes = ["auto", "related", "suggestions", "ideas"] as const;

export const keywordsSearchSchema = z.object({
  q: z.string().optional(),
  loc: z.coerce.number().int().positive().optional(),
  kLimit: z.union([z.literal(150), z.literal(300), z.literal(500)]).optional(),
  mode: z.enum(keywordModes).optional(),
  cs: booleanSearchParamSchema.optional(),
  sort: z.enum(keywordSortFields).optional(),
  order: z.enum(sortDirs).optional(),
  minVol: z.string().optional(),
  maxVol: z.string().optional(),
  minCpc: z.string().optional(),
  maxCpc: z.string().optional(),
  minKd: z.string().optional(),
  maxKd: z.string().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
  match: z
    .enum(["all", "broad", "phrase", "exact", "related", "questions"])
    .optional(),
  cluster: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  size: z
    .union([z.literal(50), z.literal(100), z.literal(300), z.literal(500)])
    .optional(),
  scale: z
    .union([
      z.literal(1000),
      z.literal(5000),
      z.literal(10000),
      z.literal(20000),
    ])
    .optional(),
  minWords: z.string().optional(),
  maxWords: z.string().optional(),
  serp: z.string().optional(),
  run: z.string().optional(),
});
