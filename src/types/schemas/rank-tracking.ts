import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { rankTrackingConfigs } from "@/db/schema";
import { isSupportedLanguageCode } from "@/shared/keyword-locations";
import { MAX_TRACKED_KEYWORD_LENGTH } from "@/shared/rank-tracking";
import { domainField } from "@/types/schemas/domain";

// ---------------------------------------------------------------------------
// DB-derived types
// ---------------------------------------------------------------------------

export type RankTrackingConfig = InferSelectModel<typeof rankTrackingConfigs>;

// ---------------------------------------------------------------------------
// API / UI types
// ---------------------------------------------------------------------------

export type RankCheckTriggerResult =
  | {
      ok: true;
      runId: string;
    }
  | {
      ok: false;
      reason: "already_running";
      blockingRunId: string | null;
    };

export interface RankTrackingDeviceResult {
  position: number | null;
  previousPosition: number | null;
  rankingUrl: string | null;
  serpFeatures: string[];
}

export interface RankTrackingRow {
  trackingKeywordId: string;
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  desktop: RankTrackingDeviceResult;
  mobile: RankTrackingDeviceResult;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const devicesEnum = z.enum(rankTrackingConfigs.devices.enumValues);
const engineEnum = z.enum(rankTrackingConfigs.engine.enumValues);
const scheduleEnum = z.enum(rankTrackingConfigs.scheduleInterval.enumValues);
// Rank tracking runs against the SERP API, which serves any language in any
// country — but an unknown code is a *charged* DataForSEO failure, so reject
// it here at cost 0.
const languageCodeField = z
  .string()
  .max(10)
  .refine(isSupportedLanguageCode, "Unsupported language code");
// Approved credits for one scheduled check. Positive-only: a zero or negative
// ceiling would activate a schedule that then skips every run, which reads as a
// broken tracker rather than a deliberate setting.
const maxCostCreditsField = z.number().int().positive().max(1_000_000);

export const getConfigsSchema = z.object({
  projectId: z.string().uuid(),
});

export const createConfigSchema = z.object({
  projectId: z.string().uuid(),
  domain: domainField,
  // Creation-only: `engine` is absent from updateConfigSchema on purpose, so
  // no request can repoint an existing config's history at another engine.
  engine: engineEnum.optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  locationName: z.string().min(1).max(200).optional(),
  devices: devicesEnum.optional(),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10),
  scheduleInterval: scheduleEnum.optional(),
  maxCostCredits: maxCostCreditsField.optional(),
});

export const updateConfigSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  domain: domainField.optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: languageCodeField.optional(),
  locationName: z.string().min(1).max(200).nullable().optional(),
  devices: devicesEnum.optional(),
  serpDepth: z.number().int().min(10).max(100).multipleOf(10).optional(),
  scheduleInterval: scheduleEnum.optional(),
  isActive: z.boolean().optional(),
  // Nullable so a tracker moving back to "manual" can clear its approval.
  maxCostCredits: maxCostCreditsField.nullable().optional(),
});

export const triggerCheckSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).max(2000).optional(),
});

export const comparePeriodSchema = z.enum(["1d", "7d", "30d", "90d"]);
export type ComparePeriod = z.infer<typeof comparePeriodSchema>;

export const getLatestResultsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  comparePeriod: comparePeriodSchema.optional(),
});

export const getLatestRunSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const estimateCostSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const addKeywordsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywords: z
    .array(z.string().min(1).max(MAX_TRACKED_KEYWORD_LENGTH))
    .min(1)
    .max(2000),
});

export const removeKeywordsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).min(1).max(2000),
});

export const refreshMetricsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

const deviceEnum = z.enum(["desktop", "mobile"]);
// Omitted means all retained history. Keeping the numeric form preserves
// compatibility with existing clients while removing the former 730-day cap.
const sinceDaysField = z.number().int().positive().max(3650).optional();

export const getKeywordHistorySchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  trackingKeywordId: z.string().uuid(),
  sinceDays: sinceDaysField,
});

export const getConfigTrendSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  device: deviceEnum,
  sinceDays: sinceDaysField,
});

export const getPositionMatrixSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  device: deviceEnum,
  runLimit: z.number().int().positive().max(26).default(12),
});

export const getRankReportSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  device: deviceEnum,
});

export const tagTrackingKeywordsSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).min(1).max(2000),
  tags: z.array(z.string().trim().min(1).max(64)).min(1).max(20),
});

export const getRankHistorySourcesSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
});

export const getRankHistorySourceMovementSchema = z.object({
  projectId: z.string().uuid(),
  configId: z.string().uuid(),
  sourceId: z.string().uuid(),
});
